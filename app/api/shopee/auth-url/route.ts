import { ShopeeMarketplaceService } from "@/lib/marketplace/shopee";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const url = ShopeeMarketplaceService.generateAuthUrl();
    return new Response(JSON.stringify({ url }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Failed to generate auth URL" }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }
}
