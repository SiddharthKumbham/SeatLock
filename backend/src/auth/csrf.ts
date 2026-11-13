import type { Request, Response, NextFunction } from "express";
import { frontendOrigin } from "../config.js";

export function requireSameOrigin(req: Request, res: Response, next: NextFunction) {
  if (req.get("origin") !== frontendOrigin || req.get("x-seatlock-request") !== "1") {
    res.status(403).json({ error: "Request origin not allowed" });
    return;
  }
  next();
}
