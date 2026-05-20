// Shopee Open Platform integration skeleton.
// Reference: https://open.shopee.com/documents

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
} from "../db";
import type { CallbackOutcome, WebhookOutcome } from "./types";

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
    // TODO: compute HMAC-SHA256(partner_id + api_path + timestamp, partner_key)
    // per Shopee's signing rules and append `sign` + `timestamp` query params.
    const redirect = encodeURIComponent(this.getCallbackUrl());
    return `https://partner.shopeemobile.com/api/v2/shop/auth_partner?partner_id=${creds.partnerId}&redirect=${redirect}`;
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

    // TODO: implement the real signed POST request.
    //   const timestamp = Math.floor(Date.now() / 1000);
    //   const path = "/api/v2/auth/token/get";
    //   const baseString = `${creds.partnerId}${path}${timestamp}`;
    //   const sign = hmacSha256(baseString, creds.partnerKey);
    //   const res = await fetch(`https://partner.shopeemobile.com${path}?partner_id=${creds.partnerId}&timestamp=${timestamp}&sign=${sign}`, {
    //     method: "POST",
    //     headers: { "Content-Type": "application/json" },
    //     body: JSON.stringify({ code, shop_id: Number(shopId), partner_id: Number(creds.partnerId) }),
    //   });
    //   const json = await res.json();
    //   if (json.error) return { ok: false, reason: "request_failed", message: json.message ?? json.error };
    //   return {
    //     ok: true,
    //     accessTokenEncrypted: encryptToken(json.access_token),
    //     refreshTokenEncrypted: encryptToken(json.refresh_token),
    //     expiresAt: new Date(Date.now() + json.expire_in * 1000).toISOString(),
    //   };
    void code;
    void shopId;
    void encryptToken; // silence unused-import until wired up
    return {
      ok: false,
      reason: "request_failed",
      message: "Shopee token exchange not implemented yet (TODO)",
    };
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
  async handleWebhook(
    payload: unknown,
    headers: Record<string, string>,
  ): Promise<WebhookOutcome> {
    // TODO: validate signature using Authorization header per Shopee push spec.
    //   const signature = headers["authorization"];
    //   const expected = hmacSha256(`${webhookUrl}|${rawBody}`, partnerKey);
    //   const signatureValid = signature === expected;
    // For now we record the event with signature_valid=null and let the
    // background processor decide.
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
      signature_valid: null,
      headers,
    });
    return { ok: true, duplicate: result.duplicate, eventId: result.row.id };
  },
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
