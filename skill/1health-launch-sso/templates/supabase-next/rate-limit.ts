// lib/one-health/rate-limit.ts — sliding-window limit per client IP for the 1health routes.
// In memory, so it is per server instance: on serverless or multi-instance hosting it only slows a single
// attacker down. Put a shared limiter (Upstash/Redis, Vercel Firewall, Cloudflare rules) in front for a hard limit,
// and swap this function's body for it.
import "server-only";
import type { NextRequest } from "next/server";

export const LIMITS = {
  launch: { max: 10, windowMs: 60_000 },
  "complete-registration": { max: 5, windowMs: 60_000 },
  "confirm-link": { max: 10, windowMs: 60_000 },
} as const;

const hits = new Map<string, number[]>();

/** The platform's proxy sets x-forwarded-for (Vercel, most load balancers). Without a trusted proxy it is spoofable. */
const clientIp = (req: NextRequest) =>
  req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";

export function rateLimited(req: NextRequest, bucket: keyof typeof LIMITS): boolean {
  const { max, windowMs } = LIMITS[bucket];
  const now = Date.now(), key = `${bucket}:${clientIp(req)}`;
  const recent = (hits.get(key) ?? []).filter((t) => t > now - windowMs);
  if (recent.length >= max) { hits.set(key, recent); return true; }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 10_000) for (const [k, v] of hits) if (!v.some((t) => t > now - windowMs)) hits.delete(k);
  return false;
}
