// Per-process ordering only. Cross-process protection belongs to the existing DB/Git code.
export function serialCalls() {
  let tail: Promise<unknown> = Promise.resolve();
  let stopped = false;
  return {
    run<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
      const next = tail.then(() => {
        if (stopped || signal.aborted) throw new Error('Call cancelled before execution');
        return work();
      });
      tail = next.catch(() => undefined);
      return next;
    },
    async stop(): Promise<void> { stopped = true; await tail; },
  };
}
