import type { NextRequest } from "next/server";
import { TikTokMarketplaceService } from "@/lib/marketplace/tiktok";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let payload: unknown = null;
  try {
    const text = await request.text();
    payload = text.length > 0 ? JSON.parse(text) : null;
  } catch (err) {
    logger.warn("TikTok webhook received non-JSON payload", {
      error: err instanceof Error ? err.message : String(err),
    });
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
    const result = await TikTokMarketplaceService.handleWebhook(payload, headerMap);
    return new Response(
      JSON.stringify({ ok: true, duplicate: result.ok && result.duplicate }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  } catch (err) {
    logger.error("TikTok webhook persistence failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return new Response(JSON.stringify({ ok: false }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
}
