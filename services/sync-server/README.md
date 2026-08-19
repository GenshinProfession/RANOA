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
```

Put the process behind a TLS reverse proxy or an SSH tunnel. Do not expose the HTTP listener directly to the public internet. The current server does not terminate TLS itself.

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

The checked-in `ranoa-sync.service.example` is a loopback-only systemd unit. Pair it with a PostgreSQL database and `/etc/ranoa-sync/server.env` as described above. For a single-user server without a domain, use an SSH tunnel from each client:

```powershell
ssh -N -L 34142:127.0.0.1:34141 ranoa-server
```

Then enter `http://127.0.0.1:34142` in RANOA. If a public endpoint is needed later, put the listener behind a TLS reverse proxy and add rate limiting before exposing it.
