// Centralized env access for marketplace integrations.
// Throws clearly when required values are missing instead of silently returning empty strings.

export type Marketplace = "shopee" | "tiktok";

export class EnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvError";
  }
}

function read(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function stripTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

function normalizePath(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

export function getAppBaseUrl(): string {
  const value = read("APP_BASE_URL");
  if (!value) {
    throw new EnvError("APP_BASE_URL is not configured");
  }
  if (!/^https?:\/\//i.test(value)) {
    throw new EnvError("APP_BASE_URL must start with http:// or https://");
  }
  return stripTrailingSlash(value);
}

export function tryGetAppBaseUrl(): string | null {
  try {
    return getAppBaseUrl();
  } catch {
    return null;
  }
}

export function buildUrl(path: string): string {
  return `${getAppBaseUrl()}${normalizePath(path)}`;
}

// ---------- Shopee ----------

export function getShopeeCallbackPath(): string {
  return normalizePath(read("SHOPEE_CALLBACK_PATH") ?? "/api/shopee/callback");
}

export function getShopeeWebhookPath(): string {
  return normalizePath(read("SHOPEE_WEBHOOK_PATH") ?? "/api/shopee/webhook");
}

export function getShopeeCredentials(): { partnerId: string; partnerKey: string } | null {
  const partnerId = read("SHOPEE_PARTNER_ID");
  const partnerKey = read("SHOPEE_PARTNER_KEY");
  if (!partnerId || !partnerKey) return null;
  return { partnerId, partnerKey };
}

// ---------- TikTok / Tokopedia ----------

export function getTikTokCallbackPath(): string {
  return normalizePath(read("TIKTOK_CALLBACK_PATH") ?? "/api/tiktok/callback");
}

export function getTikTokWebhookPath(): string {
  return normalizePath(read("TIKTOK_WEBHOOK_PATH") ?? "/api/tiktok/webhook");
}

export function getTikTokCredentials(): { appKey: string; appSecret: string } | null {
  const appKey = read("TIKTOK_APP_KEY");
  const appSecret = read("TIKTOK_APP_SECRET");
  if (!appKey || !appSecret) return null;
  return { appKey, appSecret };
}

// ---------- Encryption ----------

export function getEncryptionKeyRaw(): string {
  const value = read("MARKETPLACE_TOKEN_ENCRYPTION_KEY");
  if (!value) {
    throw new EnvError("MARKETPLACE_TOKEN_ENCRYPTION_KEY is not configured");
  }
  return value;
}

// ---------- Database ----------

export function getDatabaseUrl(): string | null {
  return read("DATABASE_URL") ?? null;
}
