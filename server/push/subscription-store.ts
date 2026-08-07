import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const DEFAULT_DIR = join(homedir(), ".claude-mobile");
const DEFAULT_PATH = join(DEFAULT_DIR, "push-subscriptions.json");
const MAX_SUBSCRIPTIONS = 10;

export interface StoredSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface SubscriptionStore {
  /**
   * Stores the subscription (de-duplicated by endpoint).
   *
   * Returns whether it is now on disk, so the route can answer truthfully
   * instead of reporting a 201 over an unwritable directory. A `false` from a
   * caller that already ran `isAllowedPushEndpoint` can only mean the write
   * failed — that is why the allowlist lives in exactly one predicate.
   */
  add(sub: StoredSubscription): boolean;
  list(): StoredSubscription[];
  remove(endpoint: string): void;
  count(): number;
  /** test seam */
  getPath(): string;
}

/**
 * The one push-service allowlist.
 *
 * It exists twice-over nowhere: the route and the store call this, so they
 * cannot disagree. The check is on `URL.hostname` — lowercased and
 * punycode-normalised by the parser — never on the raw string, because
 * `"https://web.push.apple.com".startsWith` also accepts
 * `https://web.push.apple.com.evil.example/x`, a host the attacker owns.
 */
export function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname;
  // The leading dot on each suffix is load-bearing: without it
  // `evilpush.apple.com` and `notwindows.com` pass.
  return (
    host === "push.apple.com" ||
    host.endsWith(".push.apple.com") ||
    host === "fcm.googleapis.com" ||
    host === "notify.windows.com" ||
    host.endsWith(".notify.windows.com") ||
    host === "updates.push.services.mozilla.com"
  );
}

/** The diagnostic half of an endpoint; the rest of it is a credential. */
function hostOf(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return "unknown";
  }
}

export function createSubscriptionStore(
  opts: { path?: string; warn?: (message: string) => void } = {},
): SubscriptionStore {
  const path = opts.path ?? DEFAULT_PATH;
  const warn = opts.warn ?? ((message: string) => console.warn(`[push] ${message}`));
  let items: StoredSubscription[] | null = null;
  // Once per store — one per process in production. The cap is small on
  // purpose, so an eviction is rare; what must never happen is a silent one.
  let warnedEviction = false;

  function load(): StoredSubscription[] {
    if (items) return items;
    try {
      if (!existsSync(path)) {
        items = [];
        return items;
      }
      const raw = readFileSync(path, "utf8");
      const parsed: unknown = JSON.parse(raw);
      items = Array.isArray(parsed)
        ? (parsed.filter(
            (entry) =>
              entry !== null && typeof entry === "object" && typeof entry.endpoint === "string",
          ) as StoredSubscription[])
        : [];
      return items;
    } catch {
      // A corrupt file is an empty store, not a startup failure; the next
      // successful write replaces it with valid JSON.
      items = [];
      return items;
    }
  }

  /**
   * Writes first, commits to memory second. The other order would let an
   * unwritable store report a subscriber the sender can never reach again
   * after a restart — and `pushSubscriberCount` would lie about it.
   */
  function save(list: StoredSubscription[]): boolean {
    try {
      const dir = dirname(path);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(path, JSON.stringify(list));
      items = list;
      return true;
    } catch {
      return false;
    }
  }

  function add(sub: StoredSubscription): boolean {
    if (!isAllowedPushEndpoint(sub.endpoint)) return false;
    const list = load().filter((entry) => entry.endpoint !== sub.endpoint);
    list.push(sub);
    while (list.length > MAX_SUBSCRIPTIONS) {
      const evicted = list.shift();
      // The one thing this feature exists to remove is a phone that stops
      // buzzing with nothing anywhere saying why. Whoever can reach this port
      // can register up to the cap, and the oldest device then drops out — so
      // an eviction leaves a trace. Host only: the endpoint is a push token.
      if (evicted && !warnedEviction) {
        warnedEviction = true;
        warn(
          `subscription limit of ${MAX_SUBSCRIPTIONS} reached — dropped the oldest registration (${hostOf(evicted.endpoint)}); that device no longer receives push and must re-subscribe`,
        );
      }
    }
    return save(list);
  }

  function list() {
    return load().slice();
  }

  function remove(endpoint: string) {
    save(load().filter((entry) => entry.endpoint !== endpoint));
  }

  function count() {
    return load().length;
  }

  return { add, list, remove, count, getPath: () => path };
}
