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

export function captureClientIdentity(input: ClientIdentityInput): {
  ip: string | null;
  device: string | null;
} {
  const forwarded = header(input.headers, "x-forwarded-for")?.split(",", 1)[0]?.trim();
  const named = input.deviceName?.trim();
  const userAgent = header(input.headers, "user-agent")?.trim();
  const device = named || userAgent;

  return {
    ip: forwarded || input.remoteAddress?.trim() || null,
    device: device ? device.slice(0, DEVICE_LIMIT) : null,
  };
}
