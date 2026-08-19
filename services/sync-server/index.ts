import { createSyncServer } from "./http.ts";

const port = Number(process.env.RANOA_SYNC_PORT ?? "34141");
const host = process.env.RANOA_SYNC_HOST ?? "127.0.0.1";
const dataDir = process.env.RANOA_SYNC_DATA_DIR ?? ".ranoa-sync-server";
const { server } = await createSyncServer({ dataDir, databaseUrl: process.env.RANOA_SYNC_DATABASE_URL });

server.listen(port, host, () => {
  console.log(`[ranoa-sync] listening on http://${host}:${port}`);
  console.log(`[ranoa-sync] encrypted store: ${dataDir}`);
});
