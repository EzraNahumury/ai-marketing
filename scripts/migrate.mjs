#!/usr/bin/env node
// Apply db/migrations/*.sql to DATABASE_URL (MySQL / MariaDB).
// Idempotent: tracks applied filenames in `schema_migrations`.
//
// Usage:
//   DATABASE_URL=mysql://user:pass@host:3306/dbname node scripts/migrate.mjs
//   npm run db:migrate

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "..", "db", "migrations");

// Load env from .env / .env.local if present (avoid extra dep).
async function loadDotenv() {
  for (const file of [".env.local", ".env"]) {
    try {
      const text = await readFile(path.resolve(process.cwd(), file), "utf8");
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq < 0) continue;
        const key = trimmed.slice(0, eq).trim();
        let value = trimmed.slice(eq + 1).trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        if (process.env[key] === undefined) process.env[key] = value;
      }
    } catch {
      /* file not present */
    }
  }
}

async function main() {
  await loadDotenv();
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set. Aborting.");
    process.exit(1);
  }

  const conn = await mysql.createConnection({
    uri: url,
    multipleStatements: true,
    timezone: "Z",
  });

  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename VARCHAR(255) NOT NULL PRIMARY KEY,
        applied_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    const files = (await readdir(MIGRATIONS_DIR))
      .filter((f) => f.endsWith(".sql"))
      .sort();

    const [appliedRows] = await conn.query("SELECT filename FROM schema_migrations");
    const applied = new Set(appliedRows.map((r) => r.filename));

    let count = 0;
    for (const file of files) {
      if (applied.has(file)) {
        console.log(`= already applied: ${file}`);
        continue;
      }
      const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
      console.log(`> applying ${file}`);
      try {
        // DDL in MySQL auto-commits per statement, so a transaction here would
        // not give atomicity for the schema changes themselves. We still gate
        // the schema_migrations insert behind the SQL execution succeeding.
        await conn.query(sql);
        await conn.query("INSERT INTO schema_migrations (filename) VALUES (?)", [file]);
        count++;
      } catch (err) {
        console.error(`! failed: ${file}`);
        throw err;
      }
    }

    if (count === 0) {
      console.log("All migrations already up to date.");
    } else {
      console.log(`Applied ${count} migration(s).`);
    }
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
