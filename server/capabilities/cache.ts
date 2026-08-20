export function createCapabilityCache<Result extends { ok: boolean }>() {
  const entries = new Map<string, Promise<Result>>();

  return {
    get(kind: string, cwd: string, load: () => Promise<Result>): Promise<Result> {
      const key = `${kind}\0${cwd}`;
      const cached = entries.get(key);
      if (cached) return cached;

      const pending = load().then(
        (result) => {
          if (!result.ok && entries.get(key) === pending) entries.delete(key);
          return result;
        },
        (error) => {
          if (entries.get(key) === pending) entries.delete(key);
          throw error;
        },
      );
      entries.set(key, pending);
      return pending;
    },
  };
}
