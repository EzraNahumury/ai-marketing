// Safe logger that redacts sensitive fields before printing.
// Use this everywhere instead of bare console.log in marketplace code.

const SENSITIVE_KEYS = new Set([
  "access_token",
  "accesstoken",
  "refresh_token",
  "refreshtoken",
  "partner_key",
  "partnerkey",
  "app_secret",
  "appsecret",
  "client_secret",
  "clientsecret",
  "secret",
  "token",
  "authorization",
  "encryption_key",
  "encryptionkey",
  "marketplace_token_encryption_key",
]);

const REDACTED = "[REDACTED]";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[depth-limit]";
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (!isPlainObject(value)) return value;

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      out[key] = REDACTED;
      continue;
    }
    out[key] = redact(val, depth + 1);
  }
  return out;
}

type LogContext = Record<string, unknown> | undefined;

function emit(level: "info" | "warn" | "error", message: string, context: LogContext) {
  const payload = {
    level,
    msg: message,
    ts: new Date().toISOString(),
    ...(context ? { ctx: redact(context) } : {}),
  };
  const line = JSON.stringify(payload);
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  info(message: string, context?: LogContext) {
    emit("info", message, context);
  },
  warn(message: string, context?: LogContext) {
    emit("warn", message, context);
  },
  error(message: string, context?: LogContext) {
    emit("error", message, context);
  },
};
