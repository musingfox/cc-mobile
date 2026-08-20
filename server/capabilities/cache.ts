export function createCapabilityCache<Result extends { ok: boolean }>() {
  const entries = new Map<string, Promise<Result>>();

  return {
    get(
      kind: string,
      cwd: string,
      load: () => Promise<Result>,
      options?: { refresh?: boolean },
    ): Promise<Result> {
      const key = `${kind}\0${cwd}`;
      const previous = entries.get(key);
      if (previous && !options?.refresh) return previous;

      const restorePrevious = (pending: Promise<Result>) => {
        if (entries.get(key) !== pending) return;
        if (previous) entries.set(key, previous);
        else entries.delete(key);
      };
      const pending = load().then(
        (result) => {
          if (!result.ok) restorePrevious(pending);
          return result;
        },
        (error) => {
          restorePrevious(pending);
          throw error;
        },
      );
      entries.set(key, pending);
      return pending;
    },
  };
}
