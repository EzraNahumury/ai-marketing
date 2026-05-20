// Shared marketplace types.

import type { Marketplace } from "../env";

export type { Marketplace };

export type CallbackOutcome =
  | { ok: true; shopId: string; marketplace: Marketplace }
  | { ok: false; code: CallbackErrorCode; message: string };

export type WebhookOutcome =
  | { ok: true; duplicate: boolean; eventId: string }
  | { ok: false; code: WebhookErrorCode; message: string };

export type CallbackErrorCode =
  | "missing_params"
  | "credentials_unconfigured"
  | "exchange_failed"
  | "internal_error";

export type WebhookErrorCode = "invalid_payload" | "internal_error";
