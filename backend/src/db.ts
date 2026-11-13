import dotenv from "dotenv";
import pg from "pg";
import { fileURLToPath } from "node:url";

dotenv.config({ path: fileURLToPath(new URL("../../.env", import.meta.url)) });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required. Copy .env.example to .env and configure PostgreSQL.");

export const pool = new pg.Pool({ connectionString, max: 10, connectionTimeoutMillis: 5000 });
pool.on("error", (error) => console.error("Idle database connection error", error));
export const query = <T extends pg.QueryResultRow>(sql: string, values: readonly unknown[] = []) => pool.query<T>(sql, [...values]);
