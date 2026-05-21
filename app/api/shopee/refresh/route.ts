import type { NextRequest } from "next/server";
import { ShopeeMarketplaceService } from "@/lib/marketplace/shopee";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let shopId: string | undefined;
  try {
    const body = await request.json() as { shop_id?: string };
    shopId = body.shop_id;
  } catch {
    return new Response(JSON.stringify({ ok: false, message: "Invalid JSON body" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  if (!shopId) {
    return new Response(JSON.stringify({ ok: false, message: "shop_id is required" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  try {
    const result = await ShopeeMarketplaceService.refreshToken(shopId);
    return new Response(JSON.stringify(result), {
      status: result.ok ? 200 : 400,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    logger.error("Shopee token refresh failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return new Response(JSON.stringify({ ok: false, message: "Internal error" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}
