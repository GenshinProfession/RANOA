export function endpointFromHostPort(host: string, port: number | string): string {
  const cleanHost = host.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "").trim();
  if (!cleanHost) return "";
  const portNumber = Number(port) || 34141;
  const formattedHost = cleanHost.includes(":") && !cleanHost.startsWith("[") ? `[${cleanHost}]` : cleanHost;
  return `http://${formattedHost}:${portNumber}`;
}

export function parseSyncEndpoint(endpoint: string | null | undefined): { host: string; port: number } {
  if (!endpoint?.trim()) return { host: "", port: 34141 };
  try {
    const url = new URL(endpoint.includes("://") ? endpoint : `http://${endpoint}`);
    return { host: url.hostname.replace(/^\[|\]$/g, ""), port: Number(url.port) || 34141 };
  } catch {
    return { host: endpoint.replace(/^https?:\/\//i, "").split(/[/:]/, 1)[0], port: 34141 };
  }
}
