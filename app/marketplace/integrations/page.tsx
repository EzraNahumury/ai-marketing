import Link from "next/link";
import { tryGetAppBaseUrl } from "@/lib/env";
import { ShopeeMarketplaceService } from "@/lib/marketplace/shopee";
import { TikTokMarketplaceService } from "@/lib/marketplace/tiktok";
import { listMarketplaceAccounts } from "@/lib/db";
import { IntegrationsClient, type CardData } from "./IntegrationsClient";

// Auth URLs are generated fresh per-click via /api/{marketplace}/auth-url to avoid stale timestamps.

export const dynamic = "force-dynamic";

type SearchParams = Promise<{
  status?: string;
  marketplace?: string;
  reason?: string;
}>;

export default async function MarketplaceIntegrationsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const baseUrl = tryGetAppBaseUrl();

  let cards: CardData[];
  if (baseUrl) {
    const [shopeeAccounts, tiktokAccounts] = await Promise.all([
      listMarketplaceAccounts("shopee"),
      listMarketplaceAccounts("tiktok"),
    ]);
    cards = [
      {
        marketplace: "shopee",
        title: "Shopee",
        callbackUrl: ShopeeMarketplaceService.getCallbackUrl(),
        webhookUrl: ShopeeMarketplaceService.getWebhookUrl(),
        connections: shopeeAccounts.map((a) => ({
          shopId: a.shop_id,
          shopName: a.shop_name,
          status: a.account_status,
          updatedAt: a.updated_at,
        })),
        sampleCallbackQuery: "code=test&shop_id=test",
      },
      {
        marketplace: "tiktok",
        title: "TikTok / Tokopedia Shop",
        callbackUrl: TikTokMarketplaceService.getCallbackUrl(),
        webhookUrl: TikTokMarketplaceService.getWebhookUrl(),
        connections: tiktokAccounts.map((a) => ({
          shopId: a.shop_id,
          shopName: a.shop_name,
          status: a.account_status,
          updatedAt: a.updated_at,
        })),
        sampleCallbackQuery: "code=test",
      },
    ];
  } else {
    cards = [];
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black px-6 py-10">
      <div className="mx-auto max-w-4xl">
        <header className="mb-8">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            <Link href="/" className="hover:underline">
              ← Home
            </Link>
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            Marketplace integrations
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Callback &amp; webhook endpoints for Shopee and TikTok/Tokopedia Shop. Use the URLs
            below when registering this app in each marketplace partner center.
          </p>
        </header>

        {!baseUrl && (
          <div className="mb-6 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
            <strong>APP_BASE_URL is not configured.</strong> Set it in your environment
            (e.g. <code className="font-mono">APP_BASE_URL=https://your-domain.com</code>)
            and reload. The callback and webhook URLs are derived from it.
          </div>
        )}

        <StatusBanner status={params.status} marketplace={params.marketplace} reason={params.reason} />

        {baseUrl && <IntegrationsClient cards={cards} />}
      </div>
    </div>
  );
}

function StatusBanner({
  status,
  marketplace,
  reason,
}: {
  status?: string;
  marketplace?: string;
  reason?: string;
}) {
  if (!status || !marketplace) return null;

  if (status === "connected") {
    return (
      <div className="mb-6 rounded-md border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-200">
        Connected to <strong>{marketplace}</strong>.
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="mb-6 rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-700 dark:bg-red-950 dark:text-red-200">
        Failed to connect to <strong>{marketplace}</strong>
        {reason ? (
          <>
            : <code className="font-mono">{reason}</code>
          </>
        ) : null}
        .
      </div>
    );
  }

  return null;
}
