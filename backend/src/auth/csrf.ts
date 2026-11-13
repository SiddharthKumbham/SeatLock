import type { Request, Response, NextFunction } from "express";

export function requireSameOrigin(req: Request, res: Response, next: NextFunction) {
  const allowed = process.env.FRONTEND_ORIGIN ?? "http://127.0.0.1:5173";
  if (req.get("origin") !== allowed || req.get("x-seatlock-request") !== "1") {
    res.status(403).json({ error: "Request origin not allowed" });
    return;
  }
  next();
}
