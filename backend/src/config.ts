import dotenv from "dotenv";
import { fileURLToPath } from "node:url";

dotenv.config({ path: fileURLToPath(new URL("../../.env", import.meta.url)) });

export const isProduction = process.env.NODE_ENV === "production";
export const demoMode = process.env.DEMO_MODE === "true";

const configuredOrigin = process.env.FRONTEND_ORIGIN;
if (isProduction && !configuredOrigin) throw new Error("FRONTEND_ORIGIN is required in production.");
export const frontendOrigin = configuredOrigin ?? "http://127.0.0.1:5173";
const originUrl = new URL(frontendOrigin);
if (originUrl.origin !== frontendOrigin || !["http:", "https:"].includes(originUrl.protocol)) {
  throw new Error("FRONTEND_ORIGIN must be an exact HTTP(S) origin without a path or trailing slash.");
}
if (isProduction && originUrl.protocol !== "https:") {
  throw new Error("FRONTEND_ORIGIN must use HTTPS in production.");
}

const configuredPort = process.env.PORT;
export const port = configuredPort === undefined ? 4000 : Number(configuredPort);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer from 1 to 65535.");
}
