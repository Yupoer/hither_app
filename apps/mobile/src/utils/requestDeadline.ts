/** Bound network work and release single-flight callers even if transport ignores abort. */
export async function requestWithDeadline<T>(
  run: (signal: AbortSignal) => PromiseLike<T>,
  timeoutMs = 10_000,
  parent?: AbortSignal | null,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  let cancel = () => {};
  try {
    return await Promise.race([
      new Promise<never>((_, reject) => {
        cancel = () => { controller.abort(); reject(new Error('request_aborted')); };
        timer = setTimeout(() => { controller.abort(); reject(new Error('request_timeout')); }, timeoutMs);
        parent?.addEventListener('abort', cancel, { once: true });
        if (parent?.aborted) cancel();
      }),
      Promise.resolve().then(() => {
        if (controller.signal.aborted) throw new Error('request_aborted');
        return run(controller.signal);
      }),
    ]);
  } finally {
    clearTimeout(timer!);
    parent?.removeEventListener('abort', cancel);
  }
}
