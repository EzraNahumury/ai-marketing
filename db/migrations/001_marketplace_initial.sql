-- Marketplace integrations — initial schema (MySQL / MariaDB).
--
-- Tested against:
--   * MySQL 8.x
--   * MariaDB 10.4+ (which is what XAMPP currently ships with)
--
-- UUID `id` columns are CHAR(36) and generated in application code via
-- node:crypto's randomUUID(); we don't rely on MySQL's UUID() (which is v1).

CREATE TABLE IF NOT EXISTS marketplace_accounts (
  id                       CHAR(36)        NOT NULL PRIMARY KEY,
  marketplace              VARCHAR(32)     NOT NULL,
  shop_id                  VARCHAR(128)    NOT NULL,
  shop_name                VARCHAR(255)    NULL,
  account_status           VARCHAR(32)     NOT NULL DEFAULT 'pending',
  access_token_encrypted   TEXT            NULL,
  refresh_token_encrypted  TEXT            NULL,
  token_expired_at         DATETIME(6)     NULL,
  raw_data                 JSON            NULL,
  created_at               DATETIME(6)     NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at               DATETIME(6)     NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uk_marketplace_accounts_shop (marketplace, shop_id),
  KEY ix_marketplace_accounts_marketplace (marketplace),
  CONSTRAINT chk_marketplace_accounts_marketplace
    CHECK (marketplace IN ('shopee', 'tiktok', 'lazada')),
  CONSTRAINT chk_marketplace_accounts_status
    CHECK (account_status IN ('pending', 'connected', 'error', 'disconnected'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS marketplace_webhook_events (
  id                    CHAR(36)       NOT NULL PRIMARY KEY,
  marketplace           VARCHAR(32)    NOT NULL,
  event_type            VARCHAR(128)   NULL,
  shop_id               VARCHAR(128)   NULL,
  marketplace_order_id  VARCHAR(128)   NULL,
  payload               JSON           NOT NULL,
  signature_valid       TINYINT(1)     NULL,
  processed             TINYINT(1)     NOT NULL DEFAULT 0,
  processed_at          DATETIME(6)    NULL,
  dedupe_hash           CHAR(64)       NOT NULL,
  created_at            DATETIME(6)    NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uk_webhook_dedupe (marketplace, dedupe_hash),
  KEY ix_webhook_unprocessed (marketplace, processed),
  KEY ix_webhook_shop (marketplace, shop_id),
  CONSTRAINT chk_webhook_marketplace
    CHECK (marketplace IN ('shopee', 'tiktok', 'lazada'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS marketplace_integration_logs (
  id           CHAR(36)      NOT NULL PRIMARY KEY,
  marketplace  VARCHAR(32)   NOT NULL,
  action       VARCHAR(128)  NOT NULL,
  status       VARCHAR(32)   NOT NULL,
  message      TEXT          NOT NULL,
  metadata     JSON          NULL,
  created_at   DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  KEY ix_integration_logs_marketplace_created (marketplace, created_at),
  CONSTRAINT chk_integration_logs_marketplace
    CHECK (marketplace IN ('shopee', 'tiktok', 'lazada')),
  CONSTRAINT chk_integration_logs_status
    CHECK (status IN ('info', 'warn', 'error', 'success'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
