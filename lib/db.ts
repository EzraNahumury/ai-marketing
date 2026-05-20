// DB abstraction for marketplace integrations.
//
// Selects backend at module load:
//   - DATABASE_URL set → MySQL / MariaDB via `mysql2/promise`
//   - unset           → JSON-file dev store at ./data/marketplace.json
//
// All callers go through the exported functions; the backend is invisible to them.

import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import mysql, { type Pool, type PoolConnection, type ResultSetHeader, type RowDataPacket } from "mysql2/promise";
import { getDatabaseUrl } from "./env";
import { logger } from "./logger";
import type { Marketplace } from "./env";

export interface MarketplaceAccountRow {
  id: string;
  marketplace: Marketplace;
  shop_id: string;
  shop_name: string | null;
  account_status: "pending" | "connected" | "error" | "disconnected";
  access_token_encrypted: string | null;
  refresh_token_encrypted: string | null;
  token_expired_at: string | null;
  raw_data: unknown;
  created_at: string;
  updated_at: string;
}

export interface WebhookEventRow {
  id: string;
  marketplace: Marketplace;
  event_type: string | null;
  shop_id: string | null;
  marketplace_order_id: string | null;
  payload: unknown;
  signature_valid: boolean | null;
  processed: boolean;
  processed_at: string | null;
  created_at: string;
  dedupe_hash: string;
}

export interface IntegrationLogRow {
  id: string;
  marketplace: Marketplace;
  action: string;
  status: "info" | "warn" | "error" | "success";
  message: string;
  metadata: unknown;
  created_at: string;
}

export interface RecordWebhookInput {
  marketplace: Marketplace;
  event_type?: string | null;
  shop_id?: string | null;
  marketplace_order_id?: string | null;
  payload: unknown;
  signature_valid?: boolean | null;
  headers: Record<string, string>;
}

export interface RecordWebhookResult {
  row: WebhookEventRow;
  duplicate: boolean;
}

interface Backend {
  upsertMarketplaceAccount(input: {
    marketplace: Marketplace;
    shop_id: string;
    shop_name?: string | null;
    account_status?: MarketplaceAccountRow["account_status"];
    access_token_encrypted?: string | null;
    refresh_token_encrypted?: string | null;
    token_expired_at?: string | null;
    raw_data?: unknown;
  }): Promise<MarketplaceAccountRow>;
  getMarketplaceAccount(
    marketplace: Marketplace,
    shop_id: string,
  ): Promise<MarketplaceAccountRow | null>;
  listMarketplaceAccounts(marketplace?: Marketplace): Promise<MarketplaceAccountRow[]>;
  recordWebhookEvent(input: RecordWebhookInput): Promise<RecordWebhookResult>;
  recordIntegrationLog(input: {
    marketplace: Marketplace;
    action: string;
    status: IntegrationLogRow["status"];
    message: string;
    metadata?: unknown;
  }): Promise<IntegrationLogRow>;
}

// ---------- Helpers ----------

function nowIso(): string {
  return new Date().toISOString();
}

function dateToIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return new Date(value).toISOString();
  return new Date().toISOString();
}

function dateToIsoOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return dateToIso(value);
}

function parseJsonField(value: unknown): unknown {
  // mysql2 returns JSON columns as already-parsed objects in most setups,
  // but if the connection is configured with `typeCast: false` (or for
  // MariaDB which exposes JSON as LONGTEXT), the field may come back as a
  // string. Normalize both.
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function dedupeHash(
  marketplace: Marketplace,
  payload: unknown,
  headers: Record<string, string>,
): string {
  const idHint =
    headers["x-shopee-event-id"] ??
    headers["x-shopee-push-id"] ??
    headers["x-tts-event-id"] ??
    headers["x-tts-signature"] ??
    headers["x-tt-signature"] ??
    null;
  const hasher = createHash("sha256");
  hasher.update(marketplace);
  hasher.update("|");
  if (idHint) {
    hasher.update(idHint);
  } else {
    hasher.update(JSON.stringify(payload ?? null));
  }
  return hasher.digest("hex");
}

// ============================================================
// MySQL / MariaDB backend
// ============================================================

function createMysqlBackend(connectionString: string): Backend {
  const pool: Pool = mysql.createPool({
    uri: connectionString,
    connectionLimit: 5,
    waitForConnections: true,
    queueLimit: 0,
    // mysql2 stringifies objects passed for JSON columns automatically when
    // we pass them through `execute`. We pass JSON.stringify ourselves below
    // so this remains predictable across MySQL/MariaDB.
    supportBigNumbers: true,
    dateStrings: false,
    timezone: "Z",
  });

  function mapAccount(row: RowDataPacket): MarketplaceAccountRow {
    return {
      id: String(row.id),
      marketplace: row.marketplace as Marketplace,
      shop_id: String(row.shop_id),
      shop_name: (row.shop_name as string | null) ?? null,
      account_status: row.account_status as MarketplaceAccountRow["account_status"],
      access_token_encrypted: (row.access_token_encrypted as string | null) ?? null,
      refresh_token_encrypted: (row.refresh_token_encrypted as string | null) ?? null,
      token_expired_at: dateToIsoOrNull(row.token_expired_at),
      raw_data: parseJsonField(row.raw_data),
      created_at: dateToIso(row.created_at),
      updated_at: dateToIso(row.updated_at),
    };
  }

  function mapEvent(row: RowDataPacket): WebhookEventRow {
    const signature = row.signature_valid;
    return {
      id: String(row.id),
      marketplace: row.marketplace as Marketplace,
      event_type: (row.event_type as string | null) ?? null,
      shop_id: (row.shop_id as string | null) ?? null,
      marketplace_order_id: (row.marketplace_order_id as string | null) ?? null,
      payload: parseJsonField(row.payload),
      signature_valid: signature === null || signature === undefined ? null : Boolean(signature),
      processed: Boolean(row.processed),
      processed_at: dateToIsoOrNull(row.processed_at),
      created_at: dateToIso(row.created_at),
      dedupe_hash: String(row.dedupe_hash),
    };
  }

  function mapLog(row: RowDataPacket): IntegrationLogRow {
    return {
      id: String(row.id),
      marketplace: row.marketplace as Marketplace,
      action: String(row.action),
      status: row.status as IntegrationLogRow["status"],
      message: String(row.message),
      metadata: parseJsonField(row.metadata),
      created_at: dateToIso(row.created_at),
    };
  }

  async function withConnection<T>(
    fn: (conn: PoolConnection) => Promise<T>,
  ): Promise<T> {
    const conn = await pool.getConnection();
    try {
      return await fn(conn);
    } finally {
      conn.release();
    }
  }

  async function fetchAccount(
    marketplace: Marketplace,
    shop_id: string,
  ): Promise<MarketplaceAccountRow | null> {
    const [rows] = await pool.execute<RowDataPacket[]>(
      "SELECT * FROM marketplace_accounts WHERE marketplace = ? AND shop_id = ? LIMIT 1",
      [marketplace, shop_id],
    );
    return rows[0] ? mapAccount(rows[0]) : null;
  }

  return {
    async upsertMarketplaceAccount(input) {
      const id = randomUUID();
      const sql = `
        INSERT INTO marketplace_accounts (
          id, marketplace, shop_id, shop_name, account_status,
          access_token_encrypted, refresh_token_encrypted, token_expired_at, raw_data
        ) VALUES (?, ?, ?, ?, COALESCE(?, 'pending'), ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          shop_name = COALESCE(VALUES(shop_name), shop_name),
          account_status = COALESCE(VALUES(account_status), account_status),
          access_token_encrypted = COALESCE(VALUES(access_token_encrypted), access_token_encrypted),
          refresh_token_encrypted = COALESCE(VALUES(refresh_token_encrypted), refresh_token_encrypted),
          token_expired_at = COALESCE(VALUES(token_expired_at), token_expired_at),
          raw_data = COALESCE(VALUES(raw_data), raw_data),
          updated_at = CURRENT_TIMESTAMP(6)
      `;
      await pool.execute<ResultSetHeader>(sql, [
        id,
        input.marketplace,
        input.shop_id,
        input.shop_name ?? null,
        input.account_status ?? null,
        input.access_token_encrypted ?? null,
        input.refresh_token_encrypted ?? null,
        input.token_expired_at ?? null,
        input.raw_data !== undefined && input.raw_data !== null
          ? JSON.stringify(input.raw_data)
          : null,
      ]);
      const row = await fetchAccount(input.marketplace, input.shop_id);
      if (!row) throw new Error("upsertMarketplaceAccount: row missing after upsert");
      return row;
    },

    async getMarketplaceAccount(marketplace, shop_id) {
      return fetchAccount(marketplace, shop_id);
    },

    async listMarketplaceAccounts(marketplace) {
      const [rows] = marketplace
        ? await pool.execute<RowDataPacket[]>(
            "SELECT * FROM marketplace_accounts WHERE marketplace = ? ORDER BY updated_at DESC",
            [marketplace],
          )
        : await pool.query<RowDataPacket[]>(
            "SELECT * FROM marketplace_accounts ORDER BY updated_at DESC",
          );
      return rows.map(mapAccount);
    },

    async recordWebhookEvent(input) {
      const hash = dedupeHash(input.marketplace, input.payload, input.headers);
      return withConnection(async (conn) => {
        await conn.beginTransaction();
        try {
          const [existing] = await conn.execute<RowDataPacket[]>(
            "SELECT * FROM marketplace_webhook_events WHERE marketplace = ? AND dedupe_hash = ? LIMIT 1",
            [input.marketplace, hash],
          );
          if (existing[0]) {
            await conn.commit();
            return { row: mapEvent(existing[0]), duplicate: true };
          }
          const id = randomUUID();
          await conn.execute<ResultSetHeader>(
            `INSERT INTO marketplace_webhook_events (
               id, marketplace, event_type, shop_id, marketplace_order_id,
               payload, signature_valid, dedupe_hash
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              id,
              input.marketplace,
              input.event_type ?? null,
              input.shop_id ?? null,
              input.marketplace_order_id ?? null,
              JSON.stringify(input.payload ?? null),
              input.signature_valid === null || input.signature_valid === undefined
                ? null
                : input.signature_valid
                  ? 1
                  : 0,
              hash,
            ],
          );
          const [inserted] = await conn.execute<RowDataPacket[]>(
            "SELECT * FROM marketplace_webhook_events WHERE id = ?",
            [id],
          );
          await conn.commit();
          if (!inserted[0]) {
            throw new Error("recordWebhookEvent: row missing after insert");
          }
          return { row: mapEvent(inserted[0]), duplicate: false };
        } catch (err) {
          await conn.rollback();
          throw err;
        }
      });
    },

    async recordIntegrationLog(input) {
      const id = randomUUID();
      await pool.execute<ResultSetHeader>(
        `INSERT INTO marketplace_integration_logs (id, marketplace, action, status, message, metadata)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          id,
          input.marketplace,
          input.action,
          input.status,
          input.message,
          input.metadata !== undefined && input.metadata !== null
            ? JSON.stringify(input.metadata)
            : null,
        ],
      );
      const [rows] = await pool.execute<RowDataPacket[]>(
        "SELECT * FROM marketplace_integration_logs WHERE id = ?",
        [id],
      );
      if (!rows[0]) throw new Error("recordIntegrationLog: row missing after insert");
      return mapLog(rows[0]);
    },
  };
}

// ============================================================
// JSON-file dev backend
// ============================================================

interface JsonStore {
  accounts: MarketplaceAccountRow[];
  webhook_events: WebhookEventRow[];
  integration_logs: IntegrationLogRow[];
}

function createJsonBackend(): Backend {
  const DATA_DIR = path.join(process.cwd(), "data");
  const DATA_FILE = path.join(DATA_DIR, "marketplace.json");
  let writeLock: Promise<void> = Promise.resolve();

  function emptyStore(): JsonStore {
    return { accounts: [], webhook_events: [], integration_logs: [] };
  }

  async function readStore(): Promise<JsonStore> {
    try {
      const raw = await fs.readFile(DATA_FILE, "utf8");
      const parsed = JSON.parse(raw) as Partial<JsonStore>;
      return {
        accounts: parsed.accounts ?? [],
        webhook_events: parsed.webhook_events ?? [],
        integration_logs: parsed.integration_logs ?? [],
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return emptyStore();
      throw err;
    }
  }

  async function writeStore(store: JsonStore): Promise<void> {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const tmp = `${DATA_FILE}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(store, null, 2), "utf8");
    await fs.rename(tmp, DATA_FILE);
  }

  async function mutate<T>(
    fn: (store: JsonStore) => Promise<{ store: JsonStore; result: T }>,
  ): Promise<T> {
    const next = writeLock.then(async () => {
      const store = await readStore();
      const { store: nextStore, result } = await fn(store);
      await writeStore(nextStore);
      return result;
    });
    writeLock = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  return {
    async upsertMarketplaceAccount(input) {
      return mutate<MarketplaceAccountRow>(async (store) => {
        const idx = store.accounts.findIndex(
          (a) => a.marketplace === input.marketplace && a.shop_id === input.shop_id,
        );
        const now = nowIso();
        const base: MarketplaceAccountRow =
          idx >= 0
            ? store.accounts[idx]
            : {
                id: randomUUID(),
                marketplace: input.marketplace,
                shop_id: input.shop_id,
                shop_name: null,
                account_status: "pending",
                access_token_encrypted: null,
                refresh_token_encrypted: null,
                token_expired_at: null,
                raw_data: null,
                created_at: now,
                updated_at: now,
              };
        const next: MarketplaceAccountRow = {
          ...base,
          shop_name: input.shop_name ?? base.shop_name,
          account_status: input.account_status ?? base.account_status,
          access_token_encrypted:
            input.access_token_encrypted !== undefined
              ? input.access_token_encrypted
              : base.access_token_encrypted,
          refresh_token_encrypted:
            input.refresh_token_encrypted !== undefined
              ? input.refresh_token_encrypted
              : base.refresh_token_encrypted,
          token_expired_at:
            input.token_expired_at !== undefined ? input.token_expired_at : base.token_expired_at,
          raw_data: input.raw_data !== undefined ? input.raw_data : base.raw_data,
          updated_at: now,
        };
        const accounts = [...store.accounts];
        if (idx >= 0) accounts[idx] = next;
        else accounts.push(next);
        return { store: { ...store, accounts }, result: next };
      });
    },

    async getMarketplaceAccount(marketplace, shop_id) {
      const store = await readStore();
      return (
        store.accounts.find((a) => a.marketplace === marketplace && a.shop_id === shop_id) ?? null
      );
    },

    async listMarketplaceAccounts(marketplace) {
      const store = await readStore();
      return marketplace
        ? store.accounts.filter((a) => a.marketplace === marketplace)
        : store.accounts;
    },

    async recordWebhookEvent(input) {
      return mutate<RecordWebhookResult>(async (store) => {
        const hash = dedupeHash(input.marketplace, input.payload, input.headers);
        const existing = store.webhook_events.find((e) => e.dedupe_hash === hash);
        if (existing) {
          return { store, result: { row: existing, duplicate: true } };
        }
        const row: WebhookEventRow = {
          id: randomUUID(),
          marketplace: input.marketplace,
          event_type: input.event_type ?? null,
          shop_id: input.shop_id ?? null,
          marketplace_order_id: input.marketplace_order_id ?? null,
          payload: input.payload,
          signature_valid: input.signature_valid ?? null,
          processed: false,
          processed_at: null,
          created_at: nowIso(),
          dedupe_hash: hash,
        };
        return {
          store: { ...store, webhook_events: [...store.webhook_events, row] },
          result: { row, duplicate: false },
        };
      });
    },

    async recordIntegrationLog(input) {
      return mutate<IntegrationLogRow>(async (store) => {
        const row: IntegrationLogRow = {
          id: randomUUID(),
          marketplace: input.marketplace,
          action: input.action,
          status: input.status,
          message: input.message,
          metadata: input.metadata ?? null,
          created_at: nowIso(),
        };
        return {
          store: { ...store, integration_logs: [...store.integration_logs, row] },
          result: row,
        };
      });
    },
  };
}

// ============================================================
// Backend selector (lazy)
// ============================================================

let backendInstance: Backend | null = null;

function backend(): Backend {
  if (backendInstance) return backendInstance;
  const url = getDatabaseUrl();
  if (url) {
    logger.info("Using MySQL backend for marketplace storage");
    backendInstance = createMysqlBackend(url);
  } else {
    logger.warn(
      "DATABASE_URL is not set. Using JSON-file dev store at ./data/marketplace.json. Do not rely on this in production.",
    );
    backendInstance = createJsonBackend();
  }
  return backendInstance;
}

// ============================================================
// Public API
// ============================================================

export function upsertMarketplaceAccount(input: {
  marketplace: Marketplace;
  shop_id: string;
  shop_name?: string | null;
  account_status?: MarketplaceAccountRow["account_status"];
  access_token_encrypted?: string | null;
  refresh_token_encrypted?: string | null;
  token_expired_at?: string | null;
  raw_data?: unknown;
}): Promise<MarketplaceAccountRow> {
  return backend().upsertMarketplaceAccount(input);
}

export function getMarketplaceAccount(
  marketplace: Marketplace,
  shop_id: string,
): Promise<MarketplaceAccountRow | null> {
  return backend().getMarketplaceAccount(marketplace, shop_id);
}

export function listMarketplaceAccounts(
  marketplace?: Marketplace,
): Promise<MarketplaceAccountRow[]> {
  return backend().listMarketplaceAccounts(marketplace);
}

export function recordWebhookEvent(input: RecordWebhookInput): Promise<RecordWebhookResult> {
  return backend().recordWebhookEvent(input);
}

export function recordIntegrationLog(input: {
  marketplace: Marketplace;
  action: string;
  status: IntegrationLogRow["status"];
  message: string;
  metadata?: unknown;
}): Promise<IntegrationLogRow> {
  return backend().recordIntegrationLog(input);
}
