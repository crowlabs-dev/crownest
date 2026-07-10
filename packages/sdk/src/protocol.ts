/* eslint-disable max-lines, max-lines-per-function -- Transport and protocol helpers stay together. */

import type {
  ApiErrorResponse,
  CancelCommandResponse,
  Command,
  CommandCollectOn,
  CommandCollectRequest,
  CommandLogStreamEvent,
  ErrorCode,
  RunCommandResponse,
} from "@crownest/contracts";

import { fetchWithRetry, retryableStatus, retryAfterMs } from "./transport-retry";

export type CrowNestClientOptions = {
  readonly apiKey?: string;
  readonly baseUrl?: string;
  readonly credential?: string;
  readonly fetch?: typeof fetch;
  readonly maxRetries?: number;
  /**
   * Unary request wall-clock deadline. For SSE, this bounds connection setup
   * and becomes the default inactivity window after response headers arrive.
   */
  readonly timeoutMs?: number;
};

export type RequestOptions = {
  /** Cancels this request without affecting other client operations. */
  readonly signal?: AbortSignal | undefined;
  /**
   * Overrides the client timeout. This is a wall-clock deadline for unary
   * requests and a connection-establishment deadline for SSE requests.
   */
  readonly timeoutMs?: number;
};

export type StreamRequestOptions = RequestOptions & {
  /**
   * Abort when no SSE bytes arrive within this window. Each chunk, including a
   * server heartbeat, resets the deadline. Defaults to `timeoutMs`.
   */
  readonly streamIdleTimeoutMs?: number | undefined;
};

export type CrowNestErrorCode = ErrorCode | (string & {});

export class CrowNestApiError extends Error {
  readonly #retryableOverride: boolean | undefined;
  readonly code: CrowNestErrorCode;
  readonly details: Readonly<Record<string, unknown>> | undefined;
  readonly requestId: string | undefined;
  readonly retryAfterMs: number | undefined;
  readonly status: number;

  constructor(status: number, error: ApiErrorPayload, headers?: Headers) {
    super(error.message);
    this.name = "CrowNestApiError";
    this.code = error.code;
    this.details = error.details;
    this.requestId = headers?.get("x-request-id") ?? undefined;
    this.retryAfterMs = retryAfterMs(headers) ?? error.retryAfterMs;
    this.#retryableOverride = error.retryable;
    this.status = status;
  }

  get retryable(): boolean {
    return (
      this.#retryableOverride ??
      (retryableStatus(this.status) ||
        this.code === "rate_limited" ||
        this.code === "slow_down" ||
        this.code === "idempotency_request_in_progress")
    );
  }
}

export type Transport = {
  download(url: string, options?: RequestOptions): Promise<Uint8Array>;
  raw(url: string, init: RawRequestInit): Promise<Response>;
  request<T>(path: string, init: ApiRequestInit): Promise<T>;
  streamSse<T>(path: string, init?: ApiStreamInit): AsyncIterable<T>;
};

type RunCommandCommonOptions = {
  readonly collect?: readonly CommandCollectRequest[];
  readonly collectOn?: CommandCollectOn;
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly idempotencyKey?: string;
  readonly onStderr?: (chunk: string) => void;
  readonly onStdout?: (chunk: string) => void;
  readonly onStreamError?: (error: unknown) => void;
  readonly timeoutMs?: number;
};

export type RunCommandOptions = RunCommandCommonOptions &
  (
    | {
        /** Return immediately while the Command continues running. */
        readonly background: true;
        readonly collect?: never;
        readonly collectOn?: never;
      }
    | {
        /** Wait for the Command to finish. This is the default. */
        readonly background?: false;
      }
  );

type ApiRequestInit = {
  readonly body?: unknown;
  readonly idempotencyKey?: string;
  readonly idempotent?: boolean;
  readonly method: "DELETE" | "GET" | "POST" | "PUT";
  readonly signal?: AbortSignal | undefined;
  readonly timeoutMs?: number;
};

type ApiStreamInit = {
  readonly body?: unknown;
  readonly idempotencyKey?: string;
  readonly idempotent?: boolean;
  readonly method?: "GET" | "POST";
  readonly signal?: AbortSignal | undefined;
  readonly streamIdleTimeoutMs?: number | undefined;
  readonly timeoutMs?: number | undefined;
};

type RawRequestInit = {
  readonly apiError?: boolean;
  readonly auth?: boolean | "same-origin";
  readonly body?: BodyInit;
  readonly headers?: HeadersInit;
  readonly idempotencyKey?: string;
  readonly idempotent?: boolean;
  readonly method: "GET" | "POST" | "PUT";
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
};

type ApiErrorPayload = ApiErrorResponse["error"] & {
  readonly retryAfterMs?: number;
  readonly retryable?: boolean;
};

export function createTransport(options: CrowNestClientOptions): Transport {
  const baseUrl = (options.baseUrl ?? "https://api.crownest.dev").replace(/\/$/, "");
  const fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
  const maxRetries = options.maxRetries ?? 2;
  const defaultTimeoutMs = options.timeoutMs;
  const credential = options.credential ?? options.apiKey ?? readEnvCredential();

  if (credential === undefined || credential.length === 0) {
    throw new Error(
      "CrowNest bearer credential missing. Pass { credential } to createCrowNestClient or set CROWNEST_BEARER_TOKEN. CROWNEST_API_KEY remains supported for developer API keys.",
    );
  }

  return {
    async download(url, requestOptions = {}) {
      const headers = new Headers();
      headers.set("accept", "application/octet-stream");

      headers.set("authorization", `Bearer ${credential}`);
      setSdkHeaders(headers);

      return withRequestSignal(
        requestOptions.signal,
        requestOptions.timeoutMs ?? defaultTimeoutMs,
        async (signal) => {
          const response = await fetchWithRetry(
            () =>
              fetchImpl(resolveUrl(baseUrl, url), {
                headers,
                method: "GET",
                signal,
              }),
            { canRetry: true, maxRetries, signal },
          );
          if (!response.ok) throw await parseErrorResponse(response);
          return new Uint8Array(await response.arrayBuffer());
        },
      );
    },
    async raw(url, init) {
      const headers = new Headers(init.headers);
      const resolvedUrl = resolveUrl(baseUrl, url);
      setSdkHeaders(headers);

      if (shouldAuthenticateRawRequest(baseUrl, resolvedUrl, init.auth)) {
        headers.set("authorization", `Bearer ${credential}`);
      }

      if (init.idempotencyKey !== undefined) {
        headers.set("idempotency-key", init.idempotencyKey);
      } else if (init.idempotent) {
        headers.set("idempotency-key", createIdempotencyKey());
      }

      const requestInit: RequestInit & { readonly duplex?: "half" } = {
        ...(init.body === undefined ? {} : { body: init.body }),
        ...(isReadableStreamBody(init.body) ? { duplex: "half" } : {}),
        headers,
        method: init.method,
      };
      const response = await withRequestSignal(
        init.signal,
        init.timeoutMs ?? defaultTimeoutMs,
        (signal) =>
          fetchWithRetry(() => fetchImpl(resolvedUrl, { ...requestInit, signal }), {
            canRetry:
              !isReadableStreamBody(init.body) &&
              (init.method === "GET" || headers.has("idempotency-key")),
            maxRetries,
            signal,
          }),
      );

      if (!response.ok) {
        if (init.apiError === false) {
          throw new Error(`Request failed with status ${response.status}.`);
        }
        throw await parseErrorResponse(response);
      }

      return response;
    },
    async request<T>(path: string, init: ApiRequestInit) {
      const headers = new Headers();
      headers.set("accept", "application/json");

      headers.set("authorization", `Bearer ${credential}`);
      setSdkHeaders(headers);

      if (init.body !== undefined) {
        headers.set("content-type", "application/json");
      }

      if (init.idempotencyKey !== undefined) {
        headers.set("idempotency-key", init.idempotencyKey);
      } else if (init.idempotent) {
        headers.set("idempotency-key", createIdempotencyKey());
      }

      return withRequestSignal(
        init.signal,
        init.timeoutMs ?? defaultTimeoutMs,
        async (signal) => {
          const response = await fetchWithRetry(
            () =>
              fetchImpl(`${baseUrl}${path}`, {
                headers,
                method: init.method,
                signal,
                ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
              }),
            {
              canRetry: init.method === "GET" || headers.has("idempotency-key"),
              maxRetries,
              signal,
            },
          );
          if (!response.ok) throw await parseErrorResponse(response);
          return (await response.json()) as T;
        },
      );
    },
    async *streamSse<T>(path: string, init: ApiStreamInit = {}) {
      const headers = new Headers();
      headers.set("accept", "text/event-stream");

      headers.set("authorization", `Bearer ${credential}`);
      setSdkHeaders(headers);

      if (init.body !== undefined) {
        headers.set("content-type", "application/json");
      }

      if (init.idempotencyKey !== undefined) {
        headers.set("idempotency-key", init.idempotencyKey);
      } else if (init.idempotent) {
        headers.set("idempotency-key", createIdempotencyKey());
      }

      const requestSignal = createRequestSignal(
        init.signal,
        init.timeoutMs ?? defaultTimeoutMs,
      );
      const streamIdleTimeoutMs =
        init.streamIdleTimeoutMs ?? init.timeoutMs ?? defaultTimeoutMs;
      try {
        const response = await fetchImpl(`${baseUrl}${path}`, {
          ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
          headers,
          method: init.method ?? "GET",
          signal: requestSignal.signal,
        });
        requestSignal.clearTimeout();
        if (!response.ok) {
          throw await parseErrorResponse(response);
        }

        if (!response.body) {
          return;
        }

        yield* parseSseStream<T>(
          response.body,
          requestSignal.signal,
          streamIdleTimeoutMs,
          requestSignal.abort,
        );
      } finally {
        requestSignal.abort();
      }
    },
  };
}

const sdkHeaderValue = "@crownest/sdk/0.1.2";

function setSdkHeaders(headers: Headers): void {
  headers.set("x-crownest-sdk", sdkHeaderValue);
}

async function withRequestSignal<T>(
  signal: AbortSignal | undefined,
  timeoutMs: number | undefined,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const requestSignal = createRequestSignal(signal, timeoutMs);
  try {
    return await operation(requestSignal.signal);
  } finally {
    requestSignal.dispose();
  }
}

function createRequestSignal(
  signal: AbortSignal | undefined,
  timeoutMs: number | undefined,
): {
  readonly abort: (reason?: unknown) => void;
  readonly clearTimeout: () => void;
  readonly dispose: () => void;
  readonly signal: AbortSignal;
} {
  const controller = new AbortController();
  const abortFromCaller = () => {
    controller.abort(signal?.reason);
  };
  if (signal?.aborted) abortFromCaller();
  else signal?.addEventListener("abort", abortFromCaller, { once: true });

  const timer =
    timeoutMs === undefined
      ? undefined
      : setTimeout(
          () => {
            controller.abort(
              new DOMException(
                `Request timed out after ${timeoutMs}ms.`,
                "TimeoutError",
              ),
            );
          },
          Math.max(0, timeoutMs),
        );
  const dispose = () => {
    if (timer !== undefined) clearTimeout(timer);
    signal?.removeEventListener("abort", abortFromCaller);
  };
  return {
    abort(reason) {
      controller.abort(reason);
      dispose();
    },
    clearTimeout() {
      if (timer !== undefined) clearTimeout(timer);
    },
    dispose,
    signal: controller.signal,
  };
}

function readEnvCredential(): string | undefined {
  // The SDK must keep working in non-Node runtimes (Workers, browsers),
  // where the process global does not exist.
  const nodeProcess = (
    globalThis as {
      readonly process?: { readonly env?: Record<string, string | undefined> };
    }
  ).process;

  return nodeProcess?.env?.CROWNEST_BEARER_TOKEN ?? nodeProcess?.env?.CROWNEST_API_KEY;
}

async function parseErrorResponse(response: Response): Promise<CrowNestApiError> {
  try {
    const payload = (await response.json()) as ApiErrorResponse;
    return new CrowNestApiError(response.status, payload.error, response.headers);
  } catch {
    return new CrowNestApiError(
      response.status,
      {
        code: "invalid_error_response",
        message: `Request failed with status ${response.status} and a non-JSON response body.`,
      },
      response.headers,
    );
  }
}

function resolveUrl(baseUrl: string, value: string): string {
  if (value.startsWith("http://") || value.startsWith("https://")) {
    return value;
  }

  if (value.startsWith("/")) {
    return `${baseUrl}${value}`;
  }

  return `${baseUrl}/${value}`;
}

function isReadableStreamBody(body: BodyInit | undefined): boolean {
  return typeof ReadableStream !== "undefined" && body instanceof ReadableStream;
}

function shouldAuthenticateRawRequest(
  baseUrl: string,
  targetUrl: string,
  auth: RawRequestInit["auth"],
): boolean {
  if (auth === false) return false;
  if (auth !== "same-origin") return true;
  return new URL(baseUrl).origin === new URL(targetUrl).origin;
}

export async function cancelCommand(
  transport: Transport,
  commandId: `cmd_${string}`,
  input: { readonly mode?: "force" | "graceful" },
): Promise<Command> {
  const response = await transport.request<CancelCommandResponse>(
    `/v1/commands/${commandId}/cancel`,
    {
      body: input,
      method: "POST",
    },
  );

  return response.command;
}

export function queryString(params: URLSearchParams): string {
  const value = params.toString();
  return value.length === 0 ? "" : `?${value}`;
}

export function commandLogParams(input: {
  readonly afterSeq?: number;
  readonly limit?: number;
  readonly reconnect?: boolean;
}): URLSearchParams {
  const params = new URLSearchParams();
  if (input.afterSeq !== undefined) {
    params.set("afterSeq", String(input.afterSeq));
  }
  if (input.limit !== undefined) {
    params.set("limit", String(input.limit));
  }

  return params;
}

export async function runSandboxCommand(
  transport: Transport,
  sandboxId: `sbx_${string}`,
  command: string,
  options: RunCommandOptions = {},
): Promise<Command> {
  const {
    idempotencyKey,
    onStderr: _onStderr,
    onStdout: _onStdout,
    onStreamError: _onStreamError,
    ...body
  } = options;
  const response = await transport.request<RunCommandResponse>(
    `/v1/sandboxes/${sandboxId}/commands`,
    {
      body: { command, ...body },
      ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
      idempotent: true,
      method: "POST",
    },
  );

  return response.command;
}

export function hasCommandLogCallbacks(options: RunCommandOptions): boolean {
  return (
    options.onStderr !== undefined ||
    options.onStdout !== undefined ||
    options.onStreamError !== undefined
  );
}

export function dispatchCommandLogEvent(
  event: CommandLogStreamEvent,
  options: Pick<RunCommandOptions, "onStderr" | "onStdout" | "onStreamError">,
): boolean {
  if (event.type === "log") {
    const callback = event.stream === "stderr" ? options.onStderr : options.onStdout;
    try {
      callback?.(event.data);
    } catch (error) {
      notifyCommandStreamError(error, options);
      return true;
    }
    return false;
  }

  if (event.type === "error") {
    notifyCommandStreamError(new Error(`${event.code}: ${event.message}`), options);
    return true;
  }

  return event.type === "terminal";
}

export function notifyCommandStreamError(
  error: unknown,
  options: Pick<RunCommandOptions, "onStreamError">,
): void {
  try {
    options.onStreamError?.(error);
  } catch {
    // User callback failures must not become unhandled background rejections.
  }
}

async function* parseSseStream<T>(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  idleTimeoutMs: number | undefined,
  abort: (reason?: unknown) => void,
): AsyncIterable<T> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed = false;

  try {
    for (;;) {
      const { done, value } = await readSseChunk(reader, signal, idleTimeoutMs, abort);
      if (done) {
        completed = true;
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";

      for (const part of parts) {
        const payload = parseSsePayload(part);
        if (payload !== undefined) {
          yield payload as T;
        }
      }
    }

    buffer += decoder.decode();
    const payload = parseSsePayload(buffer);
    if (payload !== undefined) {
      yield payload as T;
    }
    completed = true;
  } finally {
    if (!completed) {
      await reader.cancel().catch(() => undefined);
    }
    reader.releaseLock();
  }
}

function readSseChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
  idleTimeoutMs: number | undefined,
  abort: (reason?: unknown) => void,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (signal.aborted) return Promise.reject(abortReason(signal));

  return new Promise((resolve, reject) => {
    let settled = false;
    const timer =
      idleTimeoutMs === undefined
        ? undefined
        : setTimeout(
            () => {
              const error = new DOMException(
                `SSE stream received no data for ${idleTimeoutMs}ms.`,
                "TimeoutError",
              );
              abort(error);
              finish(() => {
                reject(error);
              });
            },
            Math.max(0, idleTimeoutMs),
          );
    signal.addEventListener("abort", onAbort, { once: true });

    void reader.read().then(
      (result) => {
        finish(() => {
          resolve(result);
        });
      },
      (error: unknown) => {
        finish(() => {
          reject(asError(error));
        });
      },
    );

    function onAbort() {
      finish(() => {
        reject(abortReason(signal));
      });
    }

    function finish(settle: () => void) {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      settle();
    }
  });
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The operation was aborted.", "AbortError");
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function parseSsePayload(event: string): unknown {
  const data = event
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trimStart())
    .join("\n");

  if (data.length === 0) {
    return undefined;
  }

  return JSON.parse(data) as unknown;
}

function createIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `idem_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

/* eslint-enable max-lines, max-lines-per-function -- End transport and protocol helpers. */
