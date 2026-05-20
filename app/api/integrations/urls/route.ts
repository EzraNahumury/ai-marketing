import { EnvError, tryGetAppBaseUrl } from "@/lib/env";
import { ShopeeMarketplaceService } from "@/lib/marketplace/shopee";
import { TikTokMarketplaceService } from "@/lib/marketplace/tiktok";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const baseUrl = tryGetAppBaseUrl();
  if (!baseUrl) {
    return new Response(
      JSON.stringify({ error: "APP_BASE_URL is not configured" }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }

  try {
    return Response.json({
      base_url: baseUrl,
      shopee: {
        callback_url: ShopeeMarketplaceService.getCallbackUrl(),
        webhook_url: ShopeeMarketplaceService.getWebhookUrl(),
      },
      tiktok: {
        callback_url: TikTokMarketplaceService.getCallbackUrl(),
        webhook_url: TikTokMarketplaceService.getWebhookUrl(),
      },
    });
  } catch (err) {
    const message =
      err instanceof EnvError ? err.message : "Failed to build marketplace URLs";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}
