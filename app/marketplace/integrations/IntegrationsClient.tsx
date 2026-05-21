"use client";

import { useState } from "react";

export interface ConnectionInfo {
  shopId: string;
  shopName: string | null;
  status: "pending" | "connected" | "error" | "disconnected";
  updatedAt: string;
}

export interface CardData {
  marketplace: "shopee" | "tiktok";
  title: string;
  callbackUrl: string;
  webhookUrl: string;
  connections: ConnectionInfo[];
  sampleCallbackQuery: string;
}

interface Props {
  cards: CardData[];
}

export function IntegrationsClient({ cards }: Props) {
  return (
    <div className="grid gap-6 sm:grid-cols-2">
      {cards.map((card) => (
        <Card key={card.marketplace} card={card} />
      ))}
    </div>
  );
}

function Card({ card }: { card: CardData }) {
  const [toast, setToast] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  const flash = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2500);
  };

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const res = await fetch(`/api/${card.marketplace}/auth-url`);
      const json = await res.json() as { url?: string; error?: string };
      if (!json.url) {
        flash(json.error ?? "Failed to get auth URL");
        return;
      }
      window.location.href = json.url;
    } catch {
      flash("Network error — could not get auth URL");
    } finally {
      setConnecting(false);
    }
  };

  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      flash(`${label} copied`);
    } catch {
      flash("Copy failed — select manually");
    }
  };

  const testCallback = () => {
    const url = `${card.callbackUrl}?${card.sampleCallbackQuery}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const testWebhook = async () => {
    try {
      const res = await fetch(card.webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          event: "test",
          shop_id: "test",
          message: `dummy ${card.marketplace} webhook`,
        }),
      });
      if (res.ok) {
        flash(`Webhook responded ${res.status}`);
      } else {
        flash(`Webhook failed (${res.status})`);
      }
    } catch (err) {
      flash(`Webhook failed: ${err instanceof Error ? err.message : "network error"}`);
    }
  };

  const headline =
    card.connections.length === 0
      ? "No connections yet"
      : `${card.connections.length} connection${card.connections.length === 1 ? "" : "s"}`;

  return (
    <section className="relative rounded-lg border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">{card.title}</h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{headline}</p>
        </div>
      </div>

      <UrlRow label="Callback URL" value={card.callbackUrl} onCopy={() => copy(card.callbackUrl, "Callback URL")} />
      <UrlRow label="Webhook URL" value={card.webhookUrl} onCopy={() => copy(card.webhookUrl, "Webhook URL")} />

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleConnect}
          disabled={connecting}
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {connecting ? "Connecting…" : "Connect"}
        </button>
        <button
          type="button"
          onClick={testCallback}
          className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-900 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
        >
          Test callback
        </button>
        <button
          type="button"
          onClick={testWebhook}
          className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-900 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
        >
          Test webhook
        </button>
      </div>

      {card.connections.length > 0 && (
        <div className="mt-5 border-t border-zinc-200 pt-4 dark:border-zinc-800">
          <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Connections
          </h3>
          <ul className="mt-2 space-y-1 text-xs">
            {card.connections.map((c) => (
              <li key={c.shopId} className="flex items-center justify-between gap-2">
                <span className="truncate text-zinc-700 dark:text-zinc-300">
                  <code className="font-mono">{c.shopId}</code>
                  {c.shopName ? ` — ${c.shopName}` : ""}
                </span>
                <StatusPill status={c.status} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {toast && (
        <div className="pointer-events-none absolute bottom-3 right-3 rounded-md bg-zinc-900 px-3 py-1.5 text-xs text-white shadow-lg dark:bg-zinc-100 dark:text-zinc-900">
          {toast}
        </div>
      )}
    </section>
  );
}

function UrlRow({
  label,
  value,
  onCopy,
}: {
  label: string;
  value: string;
  onCopy: () => void;
}) {
  return (
    <div className="mt-4">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</span>
        <button
          type="button"
          onClick={onCopy}
          className="text-xs font-medium text-zinc-700 hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-white"
        >
          Copy
        </button>
      </div>
      <code className="block break-all rounded-md bg-zinc-100 px-3 py-2 font-mono text-xs text-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
        {value}
      </code>
    </div>
  );
}

function StatusPill({ status }: { status: ConnectionInfo["status"] }) {
  const styles: Record<ConnectionInfo["status"], string> = {
    connected: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
    pending: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
    error: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
    disconnected: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${styles[status]}`}>
      {status}
    </span>
  );
}
