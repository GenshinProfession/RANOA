# RANOA Sync Server

The sync server stores only encrypted manifests, encrypted chunks, revision metadata, and hashed device tokens. It never receives a vault key, provider token, session path, or session plaintext.

## Local development

```powershell
$env:RANOA_SYNC_PORT = "34141"
$env:RANOA_SYNC_DATA_DIR = ".ranoa-sync-server"
npm run sync:server
```

The file store is intentionally useful for local tests and single-user development. Production should set `RANOA_SYNC_DATABASE_URL`; the server then uses PostgreSQL for the state journal and chunk CAS.

## Production environment

```text
RANOA_SYNC_PORT=34141
RANOA_SYNC_HOST=127.0.0.1
RANOA_SYNC_DATA_DIR=/var/lib/ranoa-sync
RANOA_SYNC_DATABASE_URL=postgresql://ranoa_sync:<password>@127.0.0.1:5432/ranoa_sync
# For direct LAN/VPC access, bind the service to the server network interface:
# RANOA_SYNC_HOST=0.0.0.0
# Optional application-level account gate:
# RANOA_SYNC_USERNAME=your-account
# RANOA_SYNC_PASSWORD=use-a-long-random-password
```

Put the process behind a TLS reverse proxy or an SSH tunnel. Do not expose the HTTP listener directly to the public internet. The current server does not terminate TLS itself.

In the RANOA settings UI, enter the server IP or hostname and port separately (for example `129.204.42.30` and `34141`). The full URL is assembled locally. Account/password fields are optional and only needed when `RANOA_SYNC_USERNAME` and `RANOA_SYNC_PASSWORD` are configured on the server. The password is stored in the local device-only connection file and is not included in encrypted sync data.

## Safety properties

- Pairing codes expire after ten minutes and are single-use.
- Device tokens are stored as SHA-256 hashes.
- Vault keys are wrapped to each device public key with X25519 + AES-256-GCM.
- Every chunk is encrypted client-side and addressed by a vault HMAC.
- Object commits require a base revision and idempotent operation ID.
- Session writes can acquire a short-lived device lease.
- Upload and download operations create a server-side recovery snapshot first.

## Optional local automatic agent

The web UI remains manual-first. After a device has been paired and its endpoint is stored locally, a trusted machine can run the file-safe polling agent:

```powershell
$env:RANOA_SYNC_INTERVAL_MS = "60000"
npm run sync:agent
# One pass for Task Scheduler / launchd / systemd:
npm run sync:agent -- --once
```

The agent takes an exclusive local lock, rescans the portable Pi data, pauses on an open conflict, and never uploads credentials, trust state, caches, or platform binaries. Use the web settings page to review conflicts and snapshots before resolving them.

## Remote Ubuntu deployment

The RANOA settings page now has a user-facing **Deploy my sync server** flow. Enter the Ubuntu server IP, SSH port, SSH account/password, and a device name. The local app checks Node.js 22/npm, uploads the minimal encrypted sync service bundle, creates the `ranoa-sync` system user and data directory, installs a systemd unit, generates a private application credential, and creates the first vault/device. The SSH password is used only for that installation request and is not saved as sync data.

The deployed first version binds the sync service to the server network interface so it can be reached at `http://<server-ip>:34141`. Keep this behind a firewall/VPC or switch to the SSH-tunnel transport before exposing it to the public internet. For a single-user server without a domain, the manual tunnel remains available:

```powershell
ssh -N -L 34142:127.0.0.1:34141 ranoa-server
```

Then enter `127.0.0.1` and `34142` in RANOA. The app remembers the endpoint, device name, and paired device identity locally, so later launches reuse the connection automatically. If a public endpoint is needed later, put the listener behind a TLS reverse proxy and add rate limiting before exposing it.
