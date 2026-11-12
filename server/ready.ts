// The renderer's readiness (PRONTO-451): ready once it has synced and the door
// it reads every page from answers. The door's answer is asked with its own
// bound (2 s, never DOOR_TIMEOUT_MS's 41) and kept a few seconds, so a probe
// every 5 s from each pod costs the door one read, not one per probe, and a
// slow door fails the probe fast instead of timing it out. Liveness never
// reads this: a slow door must not restart a pod.

export interface DoorReadiness {
  (): Promise<boolean>;
}

export function doorReadiness(opts: {
  fetch: typeof fetch;
  url: string;
  timeoutMs?: number;
  ttlMs?: number;
  now?: () => number;
}): DoorReadiness {
  const timeoutMs = opts.timeoutMs ?? 2000;
  const ttlMs = opts.ttlMs ?? 3000;
  const now = opts.now ?? Date.now;
  let last: { ok: boolean; at: number } | undefined;
  let inflight: Promise<boolean> | undefined;
  const ask = async (): Promise<boolean> => {
    const ctl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Raced as well as aborted: a fetch that ignores its signal still fails on time.
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { ctl.abort(); reject(new Error(`door slower than ${timeoutMs} ms`)); }, timeoutMs);
    });
    try {
      const res = await Promise.race([opts.fetch(opts.url, { signal: ctl.signal }), timeout]);
      await res.body?.cancel();
      return res.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  };
  return () => {
    if (last && now() - last.at < ttlMs) return Promise.resolve(last.ok);
    inflight ??= ask().then((ok) => { last = { ok, at: now() }; return ok; }).finally(() => { inflight = undefined; });
    return inflight;
  };
}
