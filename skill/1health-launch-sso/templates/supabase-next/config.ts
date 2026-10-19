// lib/one-health/config.ts — paths and policy shared by the 1health route handlers. ← adapt the paths.
export const SIGN_IN = "/login";
export const SIGN_UP = "/signup";   // may carry a query string, e.g. "/signup?invite=open"
export const HOME = "/";
export const POLICY: "auto-link" | "confirm-first-link" =
  process.env.ONE_HEALTH_LINK_POLICY === "confirm-first-link" ? "confirm-first-link" : "auto-link";

/** Append a query param to a path that may already carry a query string. */
export const withParam = (path: string, key: string, value: string) =>
  `${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(value)}`;
