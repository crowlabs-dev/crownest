export type WaitOptions = {
  readonly intervalMs?: number;
  readonly maxIntervalMs?: number;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
};

export async function pollUntil<T>(input: {
  readonly fetch: () => Promise<T>;
  readonly isTerminal: (value: T) => boolean;
  readonly options?: WaitOptions;
  readonly timeoutMessage: string;
}): Promise<T> {
  const options = input.options ?? {};
  const deadline = Date.now() + (options.timeoutMs ?? 60_000);
  const maxIntervalMs = options.maxIntervalMs ?? 5_000;
  let delayMs = options.intervalMs ?? 500;

  for (;;) {
    throwIfAborted(options.signal);
    const value = await input.fetch();
    if (input.isTerminal(value)) return value;

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) throw new Error(input.timeoutMessage);
    await abortableDelay(Math.min(delayMs, remainingMs), options.signal);
    delayMs = Math.min(maxIntervalMs, Math.max(delayMs + 1, delayMs * 1.5));
  }
}

export function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", aborted, { once: true });

    function done() {
      signal?.removeEventListener("abort", aborted);
      resolve();
    }

    function aborted() {
      clearTimeout(timer);
      reject(abortError(signal));
    }
  });
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw abortError(signal);
  }
}

function abortError(signal?: AbortSignal): Error {
  return signal?.reason instanceof Error
    ? signal.reason
    : new DOMException("The operation was aborted.", "AbortError");
}
