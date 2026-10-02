const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::]", "[::1]"]);

export const LOOPBACK_LINK_NOTE = "via tailnet · works only if the service listens beyond loopback";

/**
 * The host the page was reached by names the machine the agent runs on, so it
 * is where a loopback link in the agent's output really points. A page that is
 * itself on loopback is that machine, where the original link already works.
 *
 * The scheme stays the link's own: `tailscale serve` terminates TLS only for
 * the one port it maps, and any other port on the tailnet name is the service
 * answering directly in whatever it speaks — https forced onto a plain-http
 * dev server would fail its handshake.
 */
export function rewriteLoopbackHref(href: string, pageHostname: string): string | null {
  if (!pageHostname || LOOPBACK_HOSTS.has(pageHostname)) return null;
  let url: URL;
  try {
    // marked passes hrefs through encodeURI, which turns an IPv6 literal's
    // brackets into %5B/%5D — a host the URL parser rejects outright.
    url = new URL(href.replace(/^(https?:\/\/)%5B([^/?#]*?)%5D/i, "$1[$2]"));
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!LOOPBACK_HOSTS.has(url.hostname)) return null;
  url.hostname = pageHostname;
  return url.href;
}
