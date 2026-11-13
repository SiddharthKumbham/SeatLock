import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { pool } from "./db.js";

export async function migrate() {
  const directory = fileURLToPath(new URL("../migrations/", import.meta.url));
  const files = (await readdir(directory)).filter((name) => /^\d+_.*\.sql$/.test(name)).sort();
  const client = await pool.connect();
  try {
    for (const file of files) {
      await client.query("BEGIN");
      try {
        await client.query("SELECT pg_advisory_xact_lock(561664179)");
        await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
        const applied = await client.query("SELECT 1 FROM schema_migrations WHERE version = $1", [file]);
        if (!applied.rowCount) {
          await client.query(await readFile(fileURLToPath(new URL(`../migrations/${file}`, import.meta.url)), "utf8"));
          await client.query("INSERT INTO schema_migrations(version) VALUES ($1)", [file]);
          console.log(`Applied ${file}`);
        } else console.log(`Already applied ${file}`);
        await client.query("COMMIT");
      } catch (error) { await client.query("ROLLBACK"); throw error; }
    }
  } finally { client.release(); }
}

if (process.argv[1]?.endsWith("migrate.js")) {
  migrate().catch((error: unknown) => {
    console.error("Database migration failed", { code: (error as NodeJS.ErrnoException).code ?? "unknown", kind: error instanceof Error ? error.name : "unknown" });
    process.exitCode = 1;
  }).finally(() => pool.end());
}
