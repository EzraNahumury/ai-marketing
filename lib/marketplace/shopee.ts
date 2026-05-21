// Shopee Open Platform integration.
// Reference: https://open.shopee.com/documents/v2/OpenAPIGuide

import { createHmac } from "node:crypto";
import {
  buildUrl,
  getShopeeCallbackPath,
  getShopeeCredentials,
  getShopeeWebhookPath,
} from "../env";
import { encryptToken } from "../crypto";
import { logger } from "../logger";
import {
  recordIntegrationLog,
  recordWebhookEvent,
  upsertMarketplaceAccount,
  getMarketplaceAccount,
} from "../db";
import { decryptToken } from "../crypto";
import type { CallbackOutcome, WebhookOutcome } from "./types";

// Use test endpoint for Developing apps; switch to partner.shopeemobile.com after Go-Live.
const SHOPEE_HOST =
  process.env.SHOPEE_HOST ?? "https://partner.test-stable.shopeemobile.com";

function shopeeSign(partnerId: string, path: string, timestamp: number, partnerKey: string): string {
  const base = `${partnerId}${path}${timestamp}`;
  return createHmac("sha256", partnerKey).update(base).digest("hex");
}

const MARKETPLACE = "shopee" as const;

export const ShopeeMarketplaceService = {
  getCallbackUrl(): string {
    return buildUrl(getShopeeCallbackPath());
  },

  getWebhookUrl(): string {
    return buildUrl(getShopeeWebhookPath());
  },

  /**
   * Build the seller-facing authorize URL.
   * Spec: https://open.shopee.com/documents/v2/OpenAPIGuide
   *   GET https://partner.shopeemobile.com/api/v2/shop/auth_partner
   *   ?partner_id=...&timestamp=...&sign=...&redirect=<callback_url>
   */
  generateAuthUrl(): string {
    const creds = getShopeeCredentials();
    if (!creds) {
      throw new Error("Shopee credentials are not configured");
    }
    const path = "/api/v2/shop/auth_partner";
    const timestamp = Math.floor(Date.now() / 1000);
    const sign = shopeeSign(creds.partnerId, path, timestamp, creds.partnerKey);
    const params = new URLSearchParams({
      partner_id: creds.partnerId,
      timestamp: String(timestamp),
      sign,
      redirect: this.getCallbackUrl(),
    });
    return `${SHOPEE_HOST}${path}?${params.toString()}`;
  },

  /**
   * Exchange the authorization `code` for an access token.
   * Spec: POST https://partner.shopeemobile.com/api/v2/auth/token/get
   *
   * Returns the encrypted token pair so callers never see plaintext.
   */
  async exchangeCodeForToken(
    code: string,
    shopId: string,
  ): Promise<
    | {
        ok: true;
        accessTokenEncrypted: string;
        refreshTokenEncrypted: string;
        expiresAt: string | null;
      }
    | { ok: false; reason: "credentials_unconfigured" | "request_failed"; message: string }
  > {
    const creds = getShopeeCredentials();
    if (!creds) {
      return {
        ok: false,
        reason: "credentials_unconfigured",
        message: "Shopee credentials are not configured",
      };
    }

    try {
      const path = "/api/v2/auth/token/get";
      const timestamp = Math.floor(Date.now() / 1000);
      const sign = shopeeSign(creds.partnerId, path, timestamp, creds.partnerKey);
      const url = `${SHOPEE_HOST}${path}?partner_id=${creds.partnerId}&timestamp=${timestamp}&sign=${sign}`;

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          shop_id: Number(shopId),
          partner_id: Number(creds.partnerId),
        }),
      });

      if (!res.ok) {
        return {
          ok: false,
          reason: "request_failed",
          message: `HTTP ${res.status} from Shopee token endpoint`,
        };
      }

      const json = (await res.json()) as {
        access_token?: string;
        refresh_token?: string;
        expire_in?: number;
        error?: string;
        message?: string;
      };

      if (json.error || !json.access_token) {
        return {
          ok: false,
          reason: "request_failed",
          message: json.message ?? json.error ?? "Unknown error from Shopee",
        };
      }

      return {
        ok: true,
        accessTokenEncrypted: encryptToken(json.access_token),
        refreshTokenEncrypted: encryptToken(json.refresh_token ?? ""),
        expiresAt: json.expire_in
          ? new Date(Date.now() + json.expire_in * 1000).toISOString()
          : null,
      };
    } catch (err) {
      return {
        ok: false,
        reason: "request_failed",
        message: err instanceof Error ? err.message : "Unexpected error during token exchange",
      };
    }
  },

  /**
   * Handle the OAuth callback. Validates params, persists a pending account,
   * and attempts a token exchange when credentials are available.
   */
  async handleCallback(query: URLSearchParams): Promise<CallbackOutcome> {
    const code = query.get("code");
    const shopId = query.get("shop_id");

    if (!code || !shopId) {
      await recordIntegrationLog({
        marketplace: MARKETPLACE,
        action: "callback",
        status: "warn",
        message: "Missing code or shop_id",
        metadata: { hasCode: Boolean(code), hasShopId: Boolean(shopId) },
      });
      return { ok: false, code: "missing_params", message: "Missing code or shop_id" };
    }

    const creds = getShopeeCredentials();
    if (!creds) {
      logger.warn("Shopee callback received but credentials are not configured", {
        shopId,
      });
      await upsertMarketplaceAccount({
        marketplace: MARKETPLACE,
        shop_id: shopId,
        account_status: "pending",
        raw_data: { source: "callback_without_credentials" },
      });
      await recordIntegrationLog({
        marketplace: MARKETPLACE,
        action: "callback",
        status: "warn",
        message: "Credentials not configured; callback recorded but token exchange skipped",
        metadata: { shopId },
      });
      return {
        ok: false,
        code: "credentials_unconfigured",
        message: "Shopee credentials are not configured",
      };
    }

    try {
      const exchange = await this.exchangeCodeForToken(code, shopId);
      if (!exchange.ok) {
        await upsertMarketplaceAccount({
          marketplace: MARKETPLACE,
          shop_id: shopId,
          account_status: "error",
        });
        await recordIntegrationLog({
          marketplace: MARKETPLACE,
          action: "callback",
          status: "error",
          message: exchange.message,
          metadata: { shopId, reason: exchange.reason },
        });
        return { ok: false, code: "exchange_failed", message: exchange.message };
      }
      await upsertMarketplaceAccount({
        marketplace: MARKETPLACE,
        shop_id: shopId,
        account_status: "connected",
        access_token_encrypted: exchange.accessTokenEncrypted,
        refresh_token_encrypted: exchange.refreshTokenEncrypted,
        token_expired_at: exchange.expiresAt,
      });
      await recordIntegrationLog({
        marketplace: MARKETPLACE,
        action: "callback",
        status: "success",
        message: "Token exchanged",
        metadata: { shopId },
      });
      return { ok: true, marketplace: MARKETPLACE, shopId };
    } catch (err) {
      logger.error("Shopee callback failure", {
        shopId,
        error: err instanceof Error ? err.message : String(err),
      });
      await recordIntegrationLog({
        marketplace: MARKETPLACE,
        action: "callback",
        status: "error",
        message: "Unhandled exception during callback",
        metadata: { shopId },
      });
      return { ok: false, code: "internal_error", message: "Unhandled exception" };
    }
  },

  /**
   * Handle an incoming webhook push. Persists the raw payload and returns
   * fast; downstream processing happens off the request path.
   */
  async refreshToken(shopId: string): Promise<{ ok: true } | { ok: false; message: string }> {
    const creds = getShopeeCredentials();
    if (!creds) return { ok: false, message: "Shopee credentials are not configured" };

    const account = await getMarketplaceAccount(MARKETPLACE, shopId);
    if (!account?.refresh_token_encrypted) {
      return { ok: false, message: "No refresh token found for shop" };
    }

    let refreshTokenPlain: string;
    try {
      refreshTokenPlain = decryptToken(account.refresh_token_encrypted);
    } catch {
      return { ok: false, message: "Failed to decrypt refresh token" };
    }

    try {
      const path = "/api/v2/auth/access_token/get";
      const timestamp = Math.floor(Date.now() / 1000);
      const sign = shopeeSign(creds.partnerId, path, timestamp, creds.partnerKey);
      const url = `${SHOPEE_HOST}${path}?partner_id=${creds.partnerId}&timestamp=${timestamp}&sign=${sign}`;

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          refresh_token: refreshTokenPlain,
          shop_id: Number(shopId),
          partner_id: Number(creds.partnerId),
        }),
      });

      if (!res.ok) {
        return { ok: false, message: `HTTP ${res.status} from Shopee refresh endpoint` };
      }

      const json = (await res.json()) as {
        access_token?: string;
        refresh_token?: string;
        expire_in?: number;
        error?: string;
        message?: string;
      };

      if (json.error || !json.access_token) {
        return { ok: false, message: json.message ?? json.error ?? "Unknown error from Shopee refresh" };
      }

      await upsertMarketplaceAccount({
        marketplace: MARKETPLACE,
        shop_id: shopId,
        account_status: "connected",
        access_token_encrypted: encryptToken(json.access_token),
        refresh_token_encrypted: encryptToken(json.refresh_token ?? refreshTokenPlain),
        token_expired_at: json.expire_in
          ? new Date(Date.now() + json.expire_in * 1000).toISOString()
          : null,
      });

      await recordIntegrationLog({
        marketplace: MARKETPLACE,
        action: "token_refresh",
        status: "success",
        message: "Token refreshed",
        metadata: { shopId },
      });

      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : "Unexpected error during token refresh",
      };
    }
  },

  async handleWebhook(
    payload: unknown,
    headers: Record<string, string>,
    rawBody: string,
  ): Promise<WebhookOutcome> {
    const creds = getShopeeCredentials();
    let signatureValid: boolean | null = null;
    if (creds) {
      const signature = headers["authorization"];
      if (signature) {
        const webhookUrl = this.getWebhookUrl();
        const expected = createHmac("sha256", creds.partnerKey)
          .update(`${webhookUrl}|${rawBody}`)
          .digest("hex");
        signatureValid = signature === expected;
        if (!signatureValid) {
          logger.warn("Shopee webhook signature mismatch");
        }
      }
    }

    const eventType =
      isObject(payload) && typeof payload.code === "number" ? `shopee.${payload.code}` : null;
    const shopId =
      (isObject(payload) && (payload.shop_id as string | number | undefined)?.toString()) || null;
    const orderId =
      isObject(payload) && isObject(payload.data) && payload.data.ordersn
        ? String(payload.data.ordersn)
        : null;

    const result = await recordWebhookEvent({
      marketplace: MARKETPLACE,
      event_type: eventType,
      shop_id: shopId,
      marketplace_order_id: orderId,
      payload,
      signature_valid: signatureValid,
      headers,
    });
    return { ok: true, duplicate: result.duplicate, eventId: result.row.id };
  },
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
