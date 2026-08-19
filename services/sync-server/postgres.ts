import { Pool } from "pg";
import type { StoreFile, SyncPersistence } from "./store.ts";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS ranoa_sync_state (
  id integer PRIMARY KEY CHECK (id = 1),
  state jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ranoa_sync_chunks (
  vault_id text NOT NULL,
  chunk_id text NOT NULL,
  body bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (vault_id, chunk_id)
);
`;

export class PostgresSyncPersistence implements SyncPersistence {
  private readonly pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 8, application_name: "ranoa-sync" });
  }

  async init(): Promise<void> { await this.pool.query(SCHEMA); }

  async load(): Promise<StoreFile | null> {
    const result = await this.pool.query<{ state: StoreFile }>("SELECT state FROM ranoa_sync_state WHERE id = 1");
    return result.rows[0]?.state ?? null;
  }

  async save(data: StoreFile): Promise<void> {
    await this.pool.query(
      "INSERT INTO ranoa_sync_state (id, state) VALUES (1, $1::jsonb) ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state, updated_at = now()",
      [JSON.stringify(data)],
    );
  }

  async putChunk(vaultId: string, chunkId: string, body: Uint8Array): Promise<void> {
    await this.pool.query("INSERT INTO ranoa_sync_chunks (vault_id, chunk_id, body) VALUES ($1, $2, $3) ON CONFLICT (vault_id, chunk_id) DO NOTHING", [vaultId, chunkId, Buffer.from(body)]);
  }

  async getChunk(vaultId: string, chunkId: string): Promise<Buffer | null> {
    const result = await this.pool.query<{ body: Buffer }>("SELECT body FROM ranoa_sync_chunks WHERE vault_id = $1 AND chunk_id = $2", [vaultId, chunkId]);
    return result.rows[0]?.body ?? null;
  }

  async hasChunk(vaultId: string, chunkId: string): Promise<boolean> {
    const result = await this.pool.query("SELECT 1 FROM ranoa_sync_chunks WHERE vault_id = $1 AND chunk_id = $2", [vaultId, chunkId]);
    return result.rowCount === 1;
  }

  async close(): Promise<void> { await this.pool.end(); }
}
