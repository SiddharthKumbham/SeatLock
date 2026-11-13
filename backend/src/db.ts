import pg from "pg";
import "./config.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required. Copy .env.example to .env and configure PostgreSQL.");
const sslMode = process.env.DATABASE_SSL_MODE ?? "disable";
if (sslMode !== "disable" && sslMode !== "verify-full") {
  throw new Error("DATABASE_SSL_MODE must be disable or verify-full.");
}
const url = new URL(connectionString);
if (process.env.DATABASE_SSL_MODE && ["sslmode", "sslcert", "sslkey", "sslrootcert"].some((key) => url.searchParams.has(key))) {
  throw new Error("Set database TLS through DATABASE_SSL_MODE, not SSL options in DATABASE_URL.");
}
const ca = process.env.DATABASE_CA_CERT?.replace(/\\n/g, "\n");
const ssl = sslMode === "verify-full" ? { rejectUnauthorized: true, ...(ca ? { ca } : {}) } : undefined;

export const pool = new pg.Pool({ connectionString, ssl, max: 10, connectionTimeoutMillis: 5000 });
pool.on("error", (error) => console.error("Idle database connection error", { code: (error as NodeJS.ErrnoException).code ?? "unknown" }));
export const query = <T extends pg.QueryResultRow>(sql: string, values: readonly unknown[] = []) => pool.query<T>(sql, [...values]);
