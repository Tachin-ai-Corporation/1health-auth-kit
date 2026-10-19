// Fails the server at startup on a bad 1health config (missing cookie secret, unknown link policy).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") (await import("@/lib/one-health/config")).assertOneHealthConfig();
}
