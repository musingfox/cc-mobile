export function createCapabilityCache<Result>() {
  const entries = new Map<string, Promise<Result>>();

  return {
    get(kind: string, cwd: string, load: () => Promise<Result>): Promise<Result> {
      const key = `${kind}\0${cwd}`;
      const cached = entries.get(key);
      if (cached) return cached;

      const pending = load();
      entries.set(key, pending);
      return pending;
    },
  };
}
