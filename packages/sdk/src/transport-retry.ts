export async function fetchWithRetry(
  fetchOnce: () => Promise<Response>,
  input: {
    readonly canRetry: boolean;
    readonly maxRetries: number;
    readonly signal?: AbortSignal;
  },
): Promise<Response> {
  let attempt = 0;
  for (;;) {
    try {
      const response = await fetchOnce();
      if (
        response.ok ||
        !input.canRetry ||
        attempt >= input.maxRetries ||
        !retryableStatus(response.status)
      ) {
        return response;
      }
      await delay(
        retryAfterMs(response.headers) ?? retryDelayMs(attempt),
        input.signal,
      );
    } catch (error) {
      if (input.signal?.aborted) throw error;
      if (!input.canRetry || attempt >= input.maxRetries) {
        throw error;
      }
      await delay(retryDelayMs(attempt), input.signal);
    }
    attempt += 1;
  }
}

export function retryableStatus(status: number): boolean {
  return (
    status === 408 ||
    status === 409 ||
    status === 425 ||
    status === 429 ||
    status >= 500
  );
}

export function retryAfterMs(headers: Headers | undefined): number | undefined {
  const value = headers?.get("retry-after");
  if (value === undefined || value === null) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

function retryDelayMs(attempt: number): number {
  const exponentialMs = Math.min(4_000, 250 * 2 ** attempt);
  return Math.round(exponentialMs * (0.75 + Math.random() * 0.5));
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(abortError(signal));
  }
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

function abortError(signal?: AbortSignal): Error {
  return signal?.reason instanceof Error
    ? signal.reason
    : new DOMException("The operation was aborted.", "AbortError");
}
