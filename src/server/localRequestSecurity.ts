/**
 * A server bound to loopback is still vulnerable to DNS rebinding and
 * cross-origin browser requests. Check Host and Origin in addition to
 * the socket address before allowing access to QUILLIX's powerful API.
 */
export function validateLocalApiRequest(host: string | undefined, origin: string | undefined, port: number): boolean {
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
  if (!host || !allowedHosts.has(host.trim().toLowerCase())) return false;
  // Native clients (and CLI tools) generally do not provide Origin.
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    return parsed.protocol === 'http:' && allowedHosts.has(parsed.host.toLowerCase()) &&
      parsed.username === '' && parsed.password === '' && parsed.pathname === '/' && !parsed.search && !parsed.hash;
  } catch {
    return false;
  }
}
