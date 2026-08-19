import assert from "node:assert/strict";

const baseUrl = process.env.PI_HARNESS_BASE_URL?.trim() || "http://127.0.0.1:31141";
const provider = process.env.PI_HARNESS_E2E_PROVIDER?.trim();
const modelId = process.env.PI_HARNESS_E2E_MODEL?.trim();
const cwd = process.env.PI_HARNESS_E2E_CWD?.trim() || process.cwd();
const timeoutMs = Number(process.env.PI_HARNESS_E2E_TIMEOUT_MS || 90_000);

if (!provider || !modelId) {
  throw new Error("PI_HARNESS_E2E_PROVIDER and PI_HARNESS_E2E_MODEL are required.");
}
if (!Number.isFinite(timeoutMs) || timeoutMs < 1_000) {
  throw new Error("PI_HARNESS_E2E_TIMEOUT_MS must be at least 1000.");
}

function endpoint(pathname) {
  return new URL(pathname, baseUrl).toString();
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

async function withTimeout(promise, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function requestJson(pathname, init = {}) {
  const response = await fetch(endpoint(pathname), {
    ...init,
    headers: {
      Accept: "application/json",
      Origin: baseUrl,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${pathname} returned non-JSON status ${response.status}`);
  }
  if (!response.ok || body.error) {
    throw new Error(`${pathname} failed (${response.status}): ${body.error || text}`);
  }
  return body;
}

function openEventStream(sessionId, onEvent) {
  const controller = new AbortController();
  const connected = deferred();
  let didConnect = false;

  const completed = (async () => {
    try {
      const response = await fetch(endpoint(`/api/agent/${encodeURIComponent(sessionId)}/events`), {
        headers: { Accept: "text/event-stream" },
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        throw new Error(`SSE connection failed with status ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true }).replaceAll("\r\n", "\n");
        let boundary;
        while ((boundary = buffer.indexOf("\n\n")) !== -1) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const data = block
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart())
            .join("\n");
          if (!data) continue;
          const event = JSON.parse(data);
          if (event.type === "connected" && !didConnect) {
            didConnect = true;
            connected.resolve(event);
          }
          onEvent(event);
        }
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      if (!didConnect) connected.reject(error);
      throw error;
    }
  })();

  return { controller, connected: connected.promise, completed };
}

function assistantText(message) {
  if (typeof message?.content === "string") return message.content;
  if (!Array.isArray(message?.content)) return "";
  return message.content
    .filter((block) => block?.type === "text")
    .map((block) => block.text || "")
    .join("");
}

function countToolEvidence(messages) {
  let count = 0;
  for (const message of messages) {
    if (message?.role === "toolResult") count += 1;
    if (!Array.isArray(message?.content)) continue;
    count += message.content.filter((block) => block?.type === "toolCall").length;
  }
  return count;
}

const created = await requestJson("/api/agent/new", {
  method: "POST",
  body: JSON.stringify({
    cwd,
    type: "ensure_session",
    provider,
    modelId,
    thinkingLevel: "off",
    toolNames: ["read"],
  }),
});
const sessionId = created.sessionId;
assert.equal(created.model?.provider, provider);
assert.equal(created.model?.modelId, modelId);

const eventTypes = [];
const firstAgentStart = deferred();
const firstStream = openEventStream(sessionId, (event) => {
  eventTypes.push(event.type);
  if (event.type === "agent_start") firstAgentStart.resolve(event);
});
await withTimeout(firstStream.connected, "initial SSE connection");

await requestJson(`/api/agent/${encodeURIComponent(sessionId)}`, {
  method: "POST",
  body: JSON.stringify({
    type: "prompt",
    message: "Use the read tool to read package.json. Reply with exactly the value of its top-level name field and nothing else. You must use the tool.",
  }),
});

await withTimeout(firstAgentStart.promise, "agent_start event");
firstStream.controller.abort();
await firstStream.completed;

const terminal = deferred();
const secondStream = openEventStream(sessionId, (event) => {
  eventTypes.push(event.type);
  if (event.type === "prompt_error" || event.type === "startup_error") {
    terminal.reject(new Error(event.errorMessage || event.type));
  }
  if (event.type === "prompt_done") terminal.resolve(event);
});
const reconnectSnapshot = await withTimeout(secondStream.connected, "reconnected SSE stream");
if (reconnectSnapshot.isStreaming) {
  await withTimeout(terminal.promise, "prompt completion");
}
secondStream.controller.abort();
await secondStream.completed;

const detail = await requestJson(`/api/sessions/${encodeURIComponent(sessionId)}`);
const messages = Array.isArray(detail.context?.messages) ? detail.context.messages : [];
const assistants = messages.filter((message) => message?.role === "assistant");
const finalAssistant = assistants.at(-1);
const responseText = assistantText(finalAssistant).trim();
const usage = finalAssistant?.usage;
const toolEvidenceCount = countToolEvidence(messages);

assert.ok(eventTypes.includes("connected"), "SSE never connected");
assert.ok(eventTypes.includes("agent_start"), "agent_start was not observed");
assert.ok(responseText.includes("@agegr/pi-web"), `Unexpected assistant response: ${responseText}`);
assert.ok(toolEvidenceCount > 0, "No read tool call/result was persisted");
assert.ok(
  Number(usage?.input || 0) + Number(usage?.output || 0) > 0,
  "Assistant usage did not contain input/output tokens",
);

console.log(JSON.stringify({
  ok: true,
  sessionId,
  provider,
  modelId,
  reconnectedWhileStreaming: Boolean(reconnectSnapshot.isStreaming),
  eventTypes: [...new Set(eventTypes)],
  toolEvidenceCount,
  responseText,
  usage: {
    input: usage.input,
    output: usage.output,
    cacheRead: usage.cacheRead,
    cacheWrite: usage.cacheWrite,
    cost: usage.cost,
  },
}, null, 2));
