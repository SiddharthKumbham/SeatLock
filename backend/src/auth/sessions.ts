import { createHash, randomBytes } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { query } from "../db.js";

const COOKIE = "seatlock.sid";
const LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
export type AuthUser = { id: string; name: string; email: string; createdAt: string };
type SessionUserRow = { id: string; name: string; email: string; created_at: Date };
const hash = (token: string) => createHash("sha256").update(token).digest("hex");

function tokenFrom(req: Request): string | null {
  const raw = req.headers.cookie?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`));
  const token = raw?.slice(COOKIE.length + 1);
  return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}
function cookieOptions() {
  return { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/api", maxAge: LIFETIME_MS };
}
export async function createSession(req: Request, res: Response, userId: string) {
  await query("DELETE FROM auth_sessions WHERE expires_at <= now()");
  const previous = tokenFrom(req);
  if (previous) await query("DELETE FROM auth_sessions WHERE token_hash=$1", [hash(previous)]);
  const token = randomBytes(32).toString("base64url");
  await query("INSERT INTO auth_sessions(token_hash,user_id,expires_at) VALUES ($1,$2,$3)", [hash(token), userId, new Date(Date.now() + LIFETIME_MS)]);
  res.cookie(COOKIE, token, cookieOptions());
}
export async function destroySession(req: Request, res: Response) {
  const token = tokenFrom(req);
  if (token) await query("DELETE FROM auth_sessions WHERE token_hash=$1", [hash(token)]);
  res.clearCookie(COOKIE, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/api" });
}
export async function sessionUser(req: Request): Promise<AuthUser | null> {
  const token = tokenFrom(req);
  if (!token) return null;
  const result = await query<SessionUserRow>(`SELECT u.id,u.name,u.email,u.created_at FROM auth_sessions s
    JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at > now()`, [hash(token)]);
  const user = result.rows[0];
  return user ? { id: user.id, name: user.name, email: user.email, createdAt: user.created_at.toISOString() } : null;
}
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try { const user = await sessionUser(req); if (!user) { res.status(401).json({ error: "Authentication required" }); return; }
    res.locals.user = user; next(); }
  catch (error) { next(error); }
}
