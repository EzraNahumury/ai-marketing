import type { NextRequest } from "next/server";
import { ShopeeMarketplaceService } from "@/lib/marketplace/shopee";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let payload: unknown = null;
  try {
    const text = await request.text();
    payload = text.length > 0 ? JSON.parse(text) : null;
  } catch (err) {
    logger.warn("Shopee webhook received non-JSON payload", {
      error: err instanceof Error ? err.message : String(err),
    });
    // Still return 200: Shopee retries on non-2xx, and we already failed to parse.
    return new Response(JSON.stringify({ ok: false, reason: "invalid_json" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  const headerMap: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headerMap[key.toLowerCase()] = value;
  });

  try {
    const result = await ShopeeMarketplaceService.handleWebhook(payload, headerMap);
    return new Response(
      JSON.stringify({ ok: true, duplicate: result.ok && result.duplicate }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  } catch (err) {
    logger.error("Shopee webhook persistence failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    // Still 200 — we don't want Shopee to spam retries while we debug. The
    // failure is captured in the integration log.
    return new Response(JSON.stringify({ ok: false }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
}
