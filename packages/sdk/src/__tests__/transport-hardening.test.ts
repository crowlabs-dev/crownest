/* eslint-disable max-lines-per-function -- Transport behavior stays grouped by concern. */
import { afterEach, describe, expect, it, vi } from "vitest";

import { createCrowNestClient } from "../index";
import { CrowNestApiError } from "../protocol";

describe("transport hardening", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("fails fast at construction when no API key is available", () => {
    vi.stubEnv("CROWNEST_API_KEY", "");

    expect(() => createCrowNestClient({})).toThrow(/CROWNEST_API_KEY/);
  });

  it("falls back to the CROWNEST_API_KEY environment variable", async () => {
    vi.stubEnv("CROWNEST_API_KEY", "cnk_env_key");
    const fetchSpy = jsonFetch({ data: [] });
    const client = createCrowNestClient({ fetch: fetchSpy });

    await client.sandboxes.list();

    expect(headerFromCall(fetchSpy, "authorization")).toBe("Bearer cnk_env_key");
  });

  it("prefers the explicit apiKey option over the environment", async () => {
    vi.stubEnv("CROWNEST_API_KEY", "cnk_env_key");
    const fetchSpy = jsonFetch({ data: [] });
    const client = createCrowNestClient({ apiKey: "cnk_option_key", fetch: fetchSpy });

    await client.sandboxes.list();

    expect(headerFromCall(fetchSpy, "authorization")).toBe("Bearer cnk_option_key");
  });

  it("wraps non-JSON error bodies in a structured CrowNestApiError", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response("<html>Bad Gateway</html>", {
        headers: { "content-type": "text/html" },
        status: 502,
      }),
    );
    const client = createCrowNestClient({ apiKey: "cnk_test_key", fetch: fetchSpy });

    const failure = await client.sandboxes.list().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(CrowNestApiError);
    expect(failure).toMatchObject({
      code: "invalid_error_response",
      status: 502,
    });
  });

  it("still parses structured JSON error envelopes", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ error: { code: "not_found", message: "Missing." } }),
          { headers: { "content-type": "application/json" }, status: 404 },
        ),
      );
    const client = createCrowNestClient({ apiKey: "cnk_test_key", fetch: fetchSpy });

    const failure = await client.sandboxes.list().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(CrowNestApiError);
    expect(failure).toMatchObject({ code: "not_found", status: 404 });
  });

  it("enriches errors with request ids and code-derived retryability", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: "idempotency_request_in_progress", message: "Busy." },
        }),
        {
          headers: {
            "content-type": "application/json",
            "x-request-id": "req_test_123",
          },
          status: 409,
        },
      ),
    );
    const client = createCrowNestClient({
      apiKey: "cnk_test_key",
      fetch: fetchSpy,
      maxRetries: 0,
    });

    const failure = await client.sandboxes.list().catch((error: unknown) => error);

    expect(failure).toMatchObject({
      code: "idempotency_request_in_progress",
      requestId: "req_test_123",
      retryable: true,
      status: 409,
    });
  });

  it("identifies every request with the SDK package and version", async () => {
    const fetchSpy = jsonFetch({ data: [], hasMore: false });
    const client = createCrowNestClient({ apiKey: "cnk_test_key", fetch: fetchSpy });

    await client.sandboxes.list();

    expect(headerFromCall(fetchSpy, "x-crownest-sdk")).toBe("@crownest/sdk/0.1.2");
  });

  it("aborts a request at the configured timeout", async () => {
    const fetchSpy = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => {
              reject(abortReason(init.signal));
            },
            { once: true },
          );
        }),
    );
    const client = createCrowNestClient({
      apiKey: "cnk_test_key",
      fetch: fetchSpy,
      timeoutMs: 5,
    });

    await expect(client.sandboxes.list()).rejects.toMatchObject({
      name: "TimeoutError",
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("preserves caller aborts without retrying", async () => {
    const controller = new AbortController();
    const fetchSpy = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => {
              reject(abortReason(init.signal));
            },
            { once: true },
          );
        }),
    );
    const client = createCrowNestClient({ apiKey: "cnk_test_key", fetch: fetchSpy });
    const request = client.sandboxes.list({ signal: controller.signal });

    controller.abort(new DOMException("Stop.", "AbortError"));

    await expect(request).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe("transport retries", () => {
  it("retries retryable idempotent requests", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: { code: "slow_down", message: "Try again." } }),
          {
            headers: {
              "content-type": "application/json",
              "retry-after": "0",
            },
            status: 503,
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ sandbox: { id: "sbx_123" } }), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      );
    const client = createCrowNestClient({ apiKey: "cnk_test_key", fetch: fetchSpy });

    await expect(client.sandboxes.create()).resolves.toMatchObject({ id: "sbx_123" });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const firstKey = headerFromCall(fetchSpy, "idempotency-key", 0);
    const secondKey = headerFromCall(fetchSpy, "idempotency-key", 1);
    expect(firstKey).toBeTruthy();
    expect(secondKey).toBe(firstKey);
  });
});

describe("transport raw retries", () => {
  it("retries retryable idempotent raw requests", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: { code: "slow_down", message: "Try again." } }),
          {
            headers: {
              "content-type": "application/json",
              "retry-after": "0",
            },
            status: 503,
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            archive: {
              sha256: "a".repeat(64),
              sizeBytes: 1,
              uploadedAt: "2026-07-02T09:00:00.000Z",
            },
          }),
          { headers: { "content-type": "application/json" }, status: 200 },
        ),
      );
    const client = createCrowNestClient({ apiKey: "cnk_test_key", fetch: fetchSpy });

    await expect(
      client.workspaceRuns.uploadArchive("wsr_123", {
        bytes: new Uint8Array([1]),
        sha256: "a".repeat(64),
        sizeBytes: 1,
      }),
    ).resolves.toMatchObject({ archive: { sizeBytes: 1 } });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(headerFromCall(fetchSpy, "idempotency-key")).toBeTruthy();
  });

  it("does not retry non-idempotent mutations", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ error: { code: "slow_down", message: "Try again." } }),
        {
          headers: {
            "content-type": "application/json",
            "retry-after": "0",
          },
          status: 503,
        },
      ),
    );
    const client = createCrowNestClient({ apiKey: "cnk_test_key", fetch: fetchSpy });

    await expect(client.commands.cancel("cmd_123")).rejects.toMatchObject({
      code: "slow_down",
      retryAfterMs: 0,
      retryable: true,
      status: 503,
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

function jsonFetch(body: unknown) {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      headers: { "content-type": "application/json" },
      status: 200,
    }),
  );
}

function headerFromCall(fetchSpy: ReturnType<typeof vi.fn>, name: string, call = 0) {
  const init = fetchSpy.mock.calls[call]?.[1] as { headers?: Headers } | undefined;
  return init?.headers instanceof Headers ? init.headers.get(name) : undefined;
}

function abortReason(signal: AbortSignal | null | undefined): Error {
  return signal?.reason instanceof Error ? signal.reason : new Error("Aborted.");
}

/* eslint-enable max-lines-per-function -- End grouped transport tests. */
