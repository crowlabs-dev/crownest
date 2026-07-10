import { afterEach, describe, expect, it, vi } from "vitest";

import { createCrowNestClient } from "../index";

describe("SSE inactivity timeouts", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses timeoutMs as the default stream inactivity window", async () => {
    vi.useFakeTimers();
    const client = streamClient(stalledSseResponse());
    const iterator = client.commands
      .streamLogs("cmd_test", { timeoutMs: 100 })
      [Symbol.asyncIterator]();

    const event = iterator.next();
    const assertion = expect(event).rejects.toMatchObject({
      message: "SSE stream received no data for 100ms.",
      name: "TimeoutError",
    });
    await vi.advanceTimersByTimeAsync(100);

    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("resets the inactivity deadline whenever bytes arrive", async () => {
    vi.useFakeTimers();
    const client = streamClient(periodicHeartbeatResponse());
    const iterator = client.commands
      .streamLogs("cmd_test", {
        reconnect: false,
        streamIdleTimeoutMs: 100,
        timeoutMs: 10,
      })
      [Symbol.asyncIterator]();

    const first = iterator.next();
    await vi.advanceTimersByTimeAsync(50);
    await expect(first).resolves.toMatchObject({ done: false });

    const second = iterator.next();
    await vi.advanceTimersByTimeAsync(70);
    await expect(second).resolves.toMatchObject({ done: false });

    const third = iterator.next();
    await vi.advanceTimersByTimeAsync(70);
    await expect(third).resolves.toMatchObject({ done: false });

    const done = iterator.next();
    await vi.advanceTimersByTimeAsync(70);
    await expect(done).resolves.toEqual({ done: true, value: undefined });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("lets a caller AbortSignal win over the inactivity deadline", async () => {
    vi.useFakeTimers();
    const abortController = new AbortController();
    const client = streamClient(stalledSseResponse());
    const iterator = client.commands
      .streamLogs("cmd_test", {
        signal: abortController.signal,
        streamIdleTimeoutMs: 1_000,
      })
      [Symbol.asyncIterator]();

    const event = iterator.next();
    const assertion = expect(event).rejects.toMatchObject({
      message: "Stop streaming.",
      name: "AbortError",
    });
    abortController.abort(new DOMException("Stop streaming.", "AbortError"));

    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });
});

function streamClient(response: Response) {
  return createCrowNestClient({
    apiKey: "cnk_test_key",
    baseUrl: "https://api.test",
    fetch: vi.fn<typeof fetch>().mockResolvedValue(response),
  });
}

function stalledSseResponse(): Response {
  return new Response(new ReadableStream<Uint8Array>(), {
    headers: { "content-type": "text/event-stream" },
  });
}

function periodicHeartbeatResponse(): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        setTimeout(() => {
          controller.enqueue(heartbeat(encoder, 1));
        }, 50);
        setTimeout(() => {
          controller.enqueue(heartbeat(encoder, 2));
        }, 120);
        setTimeout(() => {
          controller.enqueue(heartbeat(encoder, 3));
        }, 190);
        setTimeout(() => {
          controller.close();
        }, 260);
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}

function heartbeat(encoder: TextEncoder, sequence: number): Uint8Array {
  return encoder.encode(
    `event: heartbeat\ndata: {"type":"heartbeat","seq":${sequence}}\n\n`,
  );
}
