import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "ssh2";

export interface SyncDeploymentInput {
  host: string;
  sshPort: number;
  username: string;
  password: string;
  syncPort: number;
}

export interface SyncDeploymentResult {
  endpoint: string;
  username: string;
  password: string;
  host: string;
  syncPort: number;
  serviceName: string;
  fingerprint: string;
}

interface RemoteFile { local: string; remote: string; }

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function randomSecret(prefix: string): string {
  return `${prefix}_${randomBytes(24).toString("base64url")}`;
}

function exec(connection: Client, command: string, stdin?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    connection.exec(command, (error, stream) => {
      if (error) return reject(error);
      let stdout = "";
      let stderr = "";
      stream.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
      stream.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
      stream.on("close", (code: number) => code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr.trim() || stdout.trim() || `Remote command exited with ${code}`)));
      if (stdin) { stream.write(stdin); stream.end(); }
    });
  });
}

function sudoCommand(command: string, password: string): { command: string; stdin: string } {
  return { command: "sudo -S -p '' bash -lc '" + command.replace(/'/g, `'\\''`) + "'", stdin: `${password}\n` };
}

async function put(connection: Client, local: string | Buffer, remote: string): Promise<void> {
  await new Promise<void>((resolve, reject) => connection.sftp((error, sftp) => {
    if (error) return reject(error);
    if (Buffer.isBuffer(local)) {
      sftp.writeFile(remote, local, (putError) => putError ? reject(putError) : resolve());
    } else {
      sftp.fastPut(local, remote, (putError) => putError ? reject(putError) : resolve());
    }
  }));
}

function connect(input: SyncDeploymentInput): Promise<Client> {
  return new Promise((resolve, reject) => {
    const connection = new Client();
    connection.once("ready", () => resolve(connection));
    connection.once("error", reject);
    connection.connect({ host: input.host, port: input.sshPort, username: input.username, password: input.password, readyTimeout: 20_000, keepaliveInterval: 10_000 });
  });
}

export async function deploySyncServer(input: SyncDeploymentInput, projectRoot: string): Promise<SyncDeploymentResult> {
  if (!/^[a-zA-Z0-9._:-]+$/.test(input.host)) throw new Error("服务器地址格式不正确");
  if (!input.username || !input.password) throw new Error("请输入服务器登录账号和密码");
  const syncUsername = `ranoa_${randomBytes(6).toString("hex")}`;
  const syncPassword = randomSecret("sync");
  const serviceName = "ranoa-sync";
  const remoteRoot = `/opt/${serviceName}`;
  const staging = `/tmp/${serviceName}-${randomBytes(6).toString("hex")}`;
  const connection = await connect(input);
  try {
    const nodePath = await exec(connection, "command -v node || true");
    if (!nodePath) throw new Error("服务器没有找到 Node.js。请先安装 Node.js 22，再重新部署。");
    const npmPath = await exec(connection, "command -v npm || true");
    if (!npmPath) throw new Error("服务器没有找到 npm。请安装 Node.js 22（包含 npm）后再部署。");
    const version = await exec(connection, `${shellQuote(nodePath)} --version`);
    if (!/^v(?:2[2-9]|[3-9]\d)/.test(version)) throw new Error(`服务器 Node.js 版本为 ${version}，需要 Node.js 22 或更高版本。`);
    const fingerprint = createHash("sha256").update(`${input.host}:${input.sshPort}:${input.username}`).digest("hex").slice(0, 16);
    await exec(connection, `mkdir -p ${shellQuote(staging)}`);
    const files: RemoteFile[] = [
      { local: join(projectRoot, "services/sync-server/index.ts"), remote: `${staging}/index.ts` },
      { local: join(projectRoot, "services/sync-server/http.ts"), remote: `${staging}/http.ts` },
      { local: join(projectRoot, "services/sync-server/store.ts"), remote: `${staging}/store.ts` },
      { local: join(projectRoot, "services/sync-server/postgres.ts"), remote: `${staging}/postgres.ts` },
      { local: join(projectRoot, "services/sync-server/package.json"), remote: `${staging}/package.json` },
      { local: join(projectRoot, "lib/sync-crypto.ts"), remote: `${staging}/sync-crypto.ts` },
      { local: join(projectRoot, "lib/sync-protocol.ts"), remote: `${staging}/sync-protocol.ts` },
    ];
    for (const file of files) { await readFile(file.local); await put(connection, file.local, file.remote); }
    const env = `RANOA_SYNC_PORT=${input.syncPort}\nRANOA_SYNC_HOST=0.0.0.0\nRANOA_SYNC_DATA_DIR=/var/lib/ranoa-sync\nRANOA_SYNC_USERNAME=${syncUsername}\nRANOA_SYNC_PASSWORD=${syncPassword}\n`;
    await put(connection, Buffer.from(Buffer.from(env).toString("base64")), `${staging}/env.b64`);
    const unit = `[Unit]\nDescription=RANOA encrypted sync server\nAfter=network.target\n\n[Service]\nType=simple\nUser=ranoa-sync\nGroup=ranoa-sync\nWorkingDirectory=${remoteRoot}\nEnvironmentFile=/etc/ranoa-sync/server.env\nExecStart=${nodePath} --experimental-strip-types ${remoteRoot}/services/sync-server/index.ts\nRestart=on-failure\nRestartSec=3\n\n[Install]\nWantedBy=multi-user.target\n`;
    await put(connection, Buffer.from(Buffer.from(unit).toString("base64")), `${staging}/unit.b64`);
    const install = [
      `id -u ranoa-sync >/dev/null 2>&1 || useradd --system --home-dir /var/lib/ranoa-sync --shell /usr/sbin/nologin ranoa-sync`,
      `mkdir -p ${remoteRoot}/services/sync-server ${remoteRoot}/lib /var/lib/ranoa-sync /etc/ranoa-sync`,
      `install -m 0644 ${staging}/index.ts ${remoteRoot}/services/sync-server/index.ts`,
      `install -m 0644 ${staging}/http.ts ${remoteRoot}/services/sync-server/http.ts`,
      `install -m 0644 ${staging}/store.ts ${remoteRoot}/services/sync-server/store.ts`,
      `install -m 0644 ${staging}/postgres.ts ${remoteRoot}/services/sync-server/postgres.ts`,
      `install -m 0644 ${staging}/package.json ${remoteRoot}/services/sync-server/package.json`,
      `install -m 0644 ${staging}/sync-crypto.ts ${remoteRoot}/lib/sync-crypto.ts`,
      `install -m 0644 ${staging}/sync-protocol.ts ${remoteRoot}/lib/sync-protocol.ts`,
      `base64 -d ${staging}/env.b64 > /etc/ranoa-sync/server.env`,
      `base64 -d ${staging}/unit.b64 > /etc/systemd/system/${serviceName}.service`,
      `chmod 600 /etc/ranoa-sync/server.env`,
      `chown -R ranoa-sync:ranoa-sync /var/lib/ranoa-sync`,
      `cd ${remoteRoot}/services/sync-server && ${nodePath} -e "require('child_process').execFileSync('${npmPath}',['install','--omit=dev'],{stdio:'inherit'})"`,
      `systemctl daemon-reload && systemctl enable --now ${serviceName}.service`,
      `rm -rf ${staging}`,
    ].join(" && ");
    const sudo = sudoCommand(install, input.password);
    await exec(connection, sudo.command, sudo.stdin);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    await exec(connection, `systemctl is-active --quiet ${serviceName}.service`);
    return { endpoint: `http://${input.host}:${input.syncPort}`, username: syncUsername, password: syncPassword, host: input.host, syncPort: input.syncPort, serviceName, fingerprint };
  } finally {
    connection.end();
  }
}
