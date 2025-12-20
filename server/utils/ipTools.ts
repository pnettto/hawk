export function getClientIp(req: Request): string {
  const h = req.headers;
  
  // RFC 7239
  const forwarded = h.get("forwarded");
  if (forwarded) {
    const match = forwarded.match(/for="?([^";, ]+)/i);
    if (match) return match[1];
  }

  const ip = h.get("cf-connecting-ip") ||
    h.get("x-client-ip") ||
    h.get("x-forwarded-for")?.split(",")[0].trim() ||
    h.get("x-real-ip") ||
    h.get("true-client-ip") ||
    h.get("x-cluster-client-ip") ||
    h.get("fastly-client-ip");

  if (ip) return ip;

  // Check for common Deno/framework augmentations
  const raw = req as any;
  const remoteAddr = raw.remoteAddr || raw.info?.remoteAddr;
  if (remoteAddr?.hostname) return remoteAddr.hostname;

  return "unknown";
}