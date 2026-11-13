import { Router } from "express";
import argon2 from "argon2";
import { rateLimit } from "express-rate-limit";
import { query } from "../db.js";
import { parseCredentials, parseRegistration } from "./validation.js";
import { createSession, destroySession, requireAuth } from "./sessions.js";

type UserRow = { id: string; name: string; email: string; password_hash: string; created_at: Date };
export const authRouter = Router();
const loginLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: "draft-7", legacyHeaders: false,
  message: { error: "Too many login attempts. Please try again later." } });
const publicUser = (row: UserRow) => ({ id: row.id, name: row.name, email: row.email, createdAt: row.created_at.toISOString() });

authRouter.post("/register", async (req, res, next) => {
  const input = parseRegistration(req.body);
  if (!input) return res.status(400).json({ error: "Enter a valid name, email, and password of at least 12 characters." });
  try {
    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
    const result = await query<UserRow>(`INSERT INTO users(name,email,password_hash) VALUES ($1,$2,$3)
      ON CONFLICT DO NOTHING RETURNING id,name,email,password_hash,created_at`, [input.name, input.email, passwordHash]);
    if (!result.rows[0]) return res.status(409).json({ error: "An account with this email already exists." });
    await createSession(req, res, result.rows[0].id);
    return res.status(201).json({ user: publicUser(result.rows[0]) });
  } catch (error) { return next(error); }
});
authRouter.post("/login", loginLimit, async (req, res, next) => {
  const input = parseCredentials(req.body);
  if (!input) return res.status(400).json({ error: "Enter a valid email and password." });
  try {
    const result = await query<UserRow>("SELECT id,name,email,password_hash,created_at FROM users WHERE lower(email)=$1", [input.email]);
    const user = result.rows[0];
    if (!user || !await argon2.verify(user.password_hash, input.password)) return res.status(401).json({ error: "Invalid email or password." });
    await createSession(req, res, user.id);
    return res.json({ user: publicUser(user) });
  } catch (error) { return next(error); }
});
authRouter.post("/logout", async (req, res, next) => {
  try { await destroySession(req, res); return res.status(204).end(); } catch (error) { return next(error); }
});
authRouter.get("/me", requireAuth, (_req, res) => res.json({ user: res.locals.user }));
