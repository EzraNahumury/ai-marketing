import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { TikTokMarketplaceService } from "@/lib/marketplace/tiktok";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams;
  const outcome = await TikTokMarketplaceService.handleCallback(query);

  if (outcome.ok) {
    redirect(`/marketplace/integrations?status=connected&marketplace=tiktok`);
  }

  logger.warn("TikTok callback redirecting with error", {
    code: outcome.code,
    message: outcome.message,
  });
  redirect(
    `/marketplace/integrations?status=error&marketplace=tiktok&reason=${encodeURIComponent(outcome.code)}`,
  );
}
