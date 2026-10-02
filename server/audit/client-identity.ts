const DEVICE_LIMIT = 200;

type HeaderSource = Headers | Record<string, string | undefined>;

export interface ClientIdentityInput {
  headers?: HeaderSource;
  remoteAddress?: string;
  deviceName?: string | null;
}

function header(source: HeaderSource | undefined, name: string): string | undefined {
  if (!source) return undefined;
  if (source instanceof Headers) return source.get(name) ?? undefined;
  return source[name] ?? source[name.toLowerCase()];
}

/**
 * A device name as every consumer compares it. The WS `?device=` and the push
 * subscription's `device` must normalise identically, or a foreground phone
 * would never match its own subscription.
 */
export function normalizeDeviceName(raw: string | null | undefined): string | null {
  const name = raw?.trim();
  return name ? name.slice(0, DEVICE_LIMIT) : null;
}

export function captureClientIdentity(input: ClientIdentityInput): {
  ip: string | null;
  device: string | null;
} {
  const forwarded = header(input.headers, "x-forwarded-for")?.split(",", 1)[0]?.trim();

  return {
    ip: forwarded || input.remoteAddress?.trim() || null,
    device:
      normalizeDeviceName(input.deviceName) ??
      normalizeDeviceName(header(input.headers, "user-agent")),
  };
}
