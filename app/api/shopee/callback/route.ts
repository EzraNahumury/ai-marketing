import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { ShopeeMarketplaceService } from "@/lib/marketplace/shopee";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams;
  const outcome = await ShopeeMarketplaceService.handleCallback(query);

  if (outcome.ok) {
    redirect(`/marketplace/integrations?status=connected&marketplace=shopee`);
  }

  logger.warn("Shopee callback redirecting with error", {
    code: outcome.code,
    message: outcome.message,
  });
  redirect(
    `/marketplace/integrations?status=error&marketplace=shopee&reason=${encodeURIComponent(outcome.code)}`,
  );
}
