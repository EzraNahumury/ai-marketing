// TikTok Shop / Tokopedia Shop Partner Center integration skeleton.
// Reference: https://partner.tiktokshop.com/docv2/

import {
  buildUrl,
  getTikTokCallbackPath,
  getTikTokCredentials,
  getTikTokWebhookPath,
} from "../env";
import { encryptToken } from "../crypto";
import { logger } from "../logger";
import {
  recordIntegrationLog,
  recordWebhookEvent,
  upsertMarketplaceAccount,
} from "../db";
import type { CallbackOutcome, WebhookOutcome } from "./types";

const MARKETPLACE = "tiktok" as const;

export const TikTokMarketplaceService = {
  getCallbackUrl(): string {
    return buildUrl(getTikTokCallbackPath());
  },

  getWebhookUrl(): string {
    return buildUrl(getTikTokWebhookPath());
  },

  /**
   * Build the seller-facing authorize URL.
   * Spec: https://services.tiktokshop.com/open/authorize?app_key=...&state=...
   */
  generateAuthUrl(state?: string): string {
    const creds = getTikTokCredentials();
    if (!creds) {
      throw new Error("TikTok credentials are not configured");
    }
    const params = new URLSearchParams({ app_key: creds.appKey });
    if (state) params.set("state", state);
    return `https://services.tiktokshop.com/open/authorize?${params.toString()}`;
  },

  /**
   * Exchange the authorization `code` for an access token.
   * Spec: GET https://auth.tiktok-shops.com/api/v2/token/get
   *   ?app_key=...&app_secret=...&auth_code=...&grant_type=authorized_code
   *
   * NOTE: Tokopedia Shop migration uses the same Partner Center; the
   * authorization endpoint may differ per region. Update when wiring up.
   */
  async exchangeCodeForToken(
    code: string,
  ): Promise<
    | {
        ok: true;
        shopId: string;
        shopName: string | null;
        accessTokenEncrypted: string;
        refreshTokenEncrypted: string;
        expiresAt: string | null;
      }
    | { ok: false; reason: "credentials_unconfigured" | "request_failed"; message: string }
  > {
    const creds = getTikTokCredentials();
    if (!creds) {
      return {
        ok: false,
        reason: "credentials_unconfigured",
        message: "TikTok credentials are not configured",
      };
    }

    try {
      const url = new URL("https://auth.tiktok-shops.com/api/v2/token/get");
      url.searchParams.set("app_key", creds.appKey);
      url.searchParams.set("app_secret", creds.appSecret);
      url.searchParams.set("auth_code", code);
      url.searchParams.set("grant_type", "authorized_code");

      const res = await fetch(url.toString());
      if (!res.ok) {
        return {
          ok: false,
          reason: "request_failed",
          message: `HTTP ${res.status} from TikTok token endpoint`,
        };
      }

      const json = (await res.json()) as {
        code: number;
        message: string;
        data?: {
          access_token: string;
          access_token_expire_in: number;
          refresh_token: string;
          open_id: string;
          seller_name?: string;
        };
      };

      if (json.code !== 0 || !json.data) {
        return {
          ok: false,
          reason: "request_failed",
          message: json.message ?? "Unknown error from TikTok",
        };
      }

      return {
        ok: true,
        shopId: json.data.open_id,
        shopName: json.data.seller_name ?? null,
        accessTokenEncrypted: encryptToken(json.data.access_token),
        refreshTokenEncrypted: encryptToken(json.data.refresh_token),
        expiresAt: json.data.access_token_expire_in
          ? new Date(json.data.access_token_expire_in * 1000).toISOString()
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
   * Handle the OAuth callback. The shop_id is not returned in the redirect
   * query for TikTok — we resolve it from the token-exchange response.
   */
  async handleCallback(query: URLSearchParams): Promise<CallbackOutcome> {
    const code = query.get("code");

    if (!code) {
      await recordIntegrationLog({
        marketplace: MARKETPLACE,
        action: "callback",
        status: "warn",
        message: "Missing authorization code",
      });
      return { ok: false, code: "missing_params", message: "Missing code" };
    }

    const creds = getTikTokCredentials();
    if (!creds) {
      logger.warn("TikTok callback received but credentials are not configured");
      await recordIntegrationLog({
        marketplace: MARKETPLACE,
        action: "callback",
        status: "warn",
        message: "Credentials not configured; callback recorded but token exchange skipped",
      });
      return {
        ok: false,
        code: "credentials_unconfigured",
        message: "TikTok credentials are not configured",
      };
    }

    try {
      const exchange = await this.exchangeCodeForToken(code);
      if (!exchange.ok) {
        await recordIntegrationLog({
          marketplace: MARKETPLACE,
          action: "callback",
          status: "error",
          message: exchange.message,
          metadata: { reason: exchange.reason },
        });
        return { ok: false, code: "exchange_failed", message: exchange.message };
      }
      await upsertMarketplaceAccount({
        marketplace: MARKETPLACE,
        shop_id: exchange.shopId,
        shop_name: exchange.shopName ?? undefined,
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
        metadata: { shopId: exchange.shopId },
      });
      return { ok: true, marketplace: MARKETPLACE, shopId: exchange.shopId };
    } catch (err) {
      logger.error("TikTok callback failure", {
        error: err instanceof Error ? err.message : String(err),
      });
      await recordIntegrationLog({
        marketplace: MARKETPLACE,
        action: "callback",
        status: "error",
        message: "Unhandled exception during callback",
      });
      return { ok: false, code: "internal_error", message: "Unhandled exception" };
    }
  },

  /**
   * Persist a TikTok webhook push for downstream processing.
   */
  async handleWebhook(
    payload: unknown,
    headers: Record<string, string>,
  ): Promise<WebhookOutcome> {
    // TODO: validate signature header (e.g. `x-tts-signature`) per:
    //   https://partner.tiktokshop.com/docv2/page/webhook-event-list
    // The signature is HMAC-SHA256(`${app_key}${timestamp}${body}`, app_secret).
    const eventType =
      isObject(payload) && typeof payload.type === "string" ? `tiktok.${payload.type}` : null;
    const shopId =
      (isObject(payload) && isObject(payload.data) && (payload.data.shop_id as string | undefined)) ||
      (isObject(payload) && (payload.shop_id as string | undefined)) ||
      null;
    const orderId =
      isObject(payload) && isObject(payload.data) && payload.data.order_id
        ? String(payload.data.order_id)
        : null;

    const result = await recordWebhookEvent({
      marketplace: MARKETPLACE,
      event_type: eventType,
      shop_id: shopId,
      marketplace_order_id: orderId,
      payload,
      signature_valid: null,
      headers,
    });
    return { ok: true, duplicate: result.duplicate, eventId: result.row.id };
  },
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
