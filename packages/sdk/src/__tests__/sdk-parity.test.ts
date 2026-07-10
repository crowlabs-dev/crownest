/* eslint-disable max-lines -- SDK parity cases stay grouped around shared fixtures. */
import { describe, expect, it, vi } from "vitest";

import { createCrowNestClient } from "../index";

describe("SDK parity additions", () => {
  registerUsageAndFilesTests();
  registerSandboxListTests();
  registerCommandCallbackTests();
  registerCommandCollectionCallbackTests();
  registerCommandReconnectTests();
  registerCommandStreamApiErrorTests();
});

function registerUsageAndFilesTests() {
  it("fetches usage summaries through the top-level client", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        computeUnitSeconds: { used: 42 },
        computeUnitSecondsPerCredit: 1_000,
        credits: { remaining: 10, used: 1 },
        period: {
          end: "2026-07-01T00:00:00.000Z",
          resetAt: "2026-07-01T00:00:00.000Z",
          start: "2026-06-01T00:00:00.000Z",
        },
        pricingVersion: "beta",
        quotas: {},
      }),
    );
    const client = createCrowNestClient({
      apiKey: "cn_live_test",
      baseUrl: "https://api.test",
      fetch: fetchMock,
    });

    await expect(client.usage()).resolves.toMatchObject({
      computeUnitSeconds: { used: 42 },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.test/v1/usage",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("round-trips direct byte helpers through base64 file APIs", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          file: { path: "/workspace/blob.bin", sizeBytes: 3, type: "file" },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ content: "AP8Q", encoding: "base64" }));
    const client = createCrowNestClient({
      apiKey: "cn_live_test",
      baseUrl: "https://api.test",
      fetch: fetchMock,
    });

    await expect(
      client.files.writeBytes(
        "sbx_123",
        "/workspace/blob.bin",
        new Uint8Array([0, 255, 16]),
      ),
    ).resolves.toMatchObject({ path: "/workspace/blob.bin" });
    await expect(
      client.files.readBytes("sbx_123", "/workspace/blob.bin"),
    ).resolves.toEqual(new Uint8Array([0, 255, 16]));
    const writeBody = fetchMock.mock.calls[0]?.[1]?.body;
    expect(typeof writeBody).toBe("string");
    expect(JSON.parse(writeBody as string)).toEqual({
      content: "AP8Q",
      encoding: "base64",
      path: "/workspace/blob.bin",
    });
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://api.test/v1/sandboxes/sbx_123/files/read?path=%2Fworkspace%2Fblob.bin&encoding=base64",
    );
  });
}

function registerSandboxListTests() {
  it("serializes sandbox metadata filters for list", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        data: [sandboxBody({ id: "sbx_123", metadata: { agent: "codex" } })],
        hasMore: false,
      }),
    );
    const client = createCrowNestClient({
      apiKey: "cn_live_test",
      baseUrl: "https://api.test",
      fetch: fetchMock,
    });

    await expect(
      client.sandboxes.list({ metadata: { "agent.id": "codex/1", stage: "eval" } }),
    ).resolves.toMatchObject({ data: [expect.objectContaining({ id: "sbx_123" })] });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://api.test/v1/sandboxes?metadata.agent.id=codex%2F1&metadata.stage=eval",
    );
  });
}

function registerCommandCallbackTests() {
  it("dispatches command callbacks while run returns the terminal command", async () => {
    const stdout = vi.fn();
    const stderr = vi.fn();
    const fetchMock = vi.fn<typeof fetch>().mockImplementation((input) => {
      const path = requestUrl(input);
      if (path.endsWith("/v1/sandboxes/sbx_123/commands")) {
        return Promise.resolve(commandResponse("running"));
      }
      if (path.endsWith("/v1/commands/cmd_123/stream")) {
        return Promise.resolve(commandStreamWithTerminalResponse());
      }
      if (path.endsWith("/v1/commands/cmd_123")) {
        return Promise.resolve(jsonResponse({ command: terminalCommand() }));
      }
      return Promise.reject(new Error(`unexpected URL ${path}`));
    });
    const client = createCrowNestClient({
      apiKey: "cn_live_test",
      baseUrl: "https://api.test",
      fetch: fetchMock,
    });

    await expect(
      client.commands.run("sbx_123", "npm test", {
        onStderr: stderr,
        onStdout: stdout,
      }),
    ).resolves.toMatchObject({ id: "cmd_123", status: "exited" });
    expect(stdout).toHaveBeenCalledWith("out\n");
    expect(stderr).toHaveBeenCalledWith("err\n");
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://api.test/v1/sandboxes/sbx_123/commands",
    );
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toEqual({
      _crownestRequireCommandRead: true,
      background: true,
      command: "npm test",
      timeoutMs: 60_000,
    });
  });

  it("streams background callbacks without surfacing handler errors", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation((input) => {
      const path = requestUrl(input);
      if (path.endsWith("/v1/sandboxes/sbx_123/commands")) {
        return Promise.resolve(commandResponse("running"));
      }
      if (path.endsWith("/v1/commands/cmd_123/stream")) {
        return Promise.resolve(erroringCommandStreamResponse());
      }
      return Promise.reject(new Error(`unexpected URL ${path}`));
    });
    const client = createCrowNestClient({
      apiKey: "cn_live_test",
      baseUrl: "https://api.test",
      fetch: fetchMock,
    });

    await expect(
      client.commands.run("sbx_123", "npm test", {
        background: true,
        onStreamError: () => {
          throw new Error("handler failed");
        },
        onStdout: () => undefined,
      }),
    ).resolves.toMatchObject({ id: "cmd_123", status: "running" });
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toEqual({
      background: true,
      command: "npm test",
    });
  });
}

function registerCommandCollectionCallbackTests() {
  it("preserves collection options for callback-backed run requests", async () => {
    const stdout = vi.fn();
    const fetchMock = vi.fn<typeof fetch>().mockImplementation((input) => {
      const path = requestUrl(input);
      if (path.endsWith("/v1/sandboxes/sbx_123/commands")) {
        return Promise.resolve(
          jsonResponse({
            command: { ...terminalCommand(), collectStatus: "succeeded" },
          }),
        );
      }
      if (path.endsWith("/v1/commands/cmd_123/logs")) {
        return Promise.resolve(commandLogsResponse());
      }
      return Promise.reject(new Error(`unexpected URL ${path}`));
    });
    const client = createCrowNestClient({
      apiKey: "cn_live_test",
      baseUrl: "https://api.test",
      fetch: fetchMock,
    });

    await expect(
      client.commands.run("sbx_123", "npm test", {
        collect: [{ path: "/workspace/out.txt" }],
        collectOn: "always",
        onStdout: stdout,
      }),
    ).resolves.toMatchObject({ collectStatus: "succeeded", id: "cmd_123" });
    expect(stdout).toHaveBeenCalledWith("collected\n");
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://api.test/v1/sandboxes/sbx_123/commands",
    );
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toMatchObject({
      _crownestRequireCommandRead: true,
      collect: [{ path: "/workspace/out.txt" }],
      collectOn: "always",
      command: "npm test",
    });
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://api.test/v1/commands/cmd_123/logs",
    );
  });
}

function registerCommandReconnectTests() {
  it("reconnects command log streams from the last seen sequence", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation((input) => {
      const path = requestUrl(input);
      if (path.endsWith("/v1/commands/cmd_123/stream")) {
        return Promise.resolve(erroringCommandStreamResponse());
      }
      if (path.endsWith("/v1/commands/cmd_123/stream?afterSeq=1")) {
        return Promise.resolve(reconnectedCommandStreamResponse());
      }
      return Promise.reject(new Error(`unexpected URL ${path}`));
    });
    const client = createCrowNestClient({
      apiKey: "cn_live_test",
      baseUrl: "https://api.test",
      fetch: fetchMock,
    });
    const events = [];

    for await (const event of client.commands.streamLogs("cmd_123")) {
      events.push(event);
    }

    expect(
      events.map((event) => (event.type === "log" ? event.seq : event.type)),
    ).toEqual([1, 2, "terminal"]);
  });

  it("does not reset the retry budget for heartbeat-only stream failures", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn<typeof fetch>().mockImplementation((input) => {
      const path = requestUrl(input);
      if (path.endsWith("/v1/commands/cmd_123/stream")) {
        return Promise.resolve(heartbeatThenInvalidJsonStreamResponse());
      }
      return Promise.reject(new Error(`unexpected URL ${path}`));
    });
    const client = createCrowNestClient({
      apiKey: "cn_live_test",
      baseUrl: "https://api.test",
      fetch: fetchMock,
    });
    const events: unknown[] = [];
    const stream = (async () => {
      for await (const event of client.commands.streamLogs("cmd_123")) {
        events.push(event);
      }
    })();
    const streamExpectation = expect(stream).rejects.toThrow();

    try {
      await vi.advanceTimersByTimeAsync(8_000);
      await streamExpectation;
    } finally {
      vi.useRealTimers();
    }
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(events).toHaveLength(6);
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual(
      Array.from({ length: 6 }, () => "https://api.test/v1/commands/cmd_123/stream"),
    );
  });
}

function registerCommandStreamApiErrorTests() {
  it("does not retry structured stream API errors", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse({ error: { code: "stream_gap", message: "Missing logs." } }, 409),
      );
    const client = createCrowNestClient({
      apiKey: "cn_live_test",
      baseUrl: "https://api.test",
      fetch: fetchMock,
    });
    const stream = (async () => {
      for await (const _event of client.commands.streamLogs("cmd_123")) {
        // Drain the stream to surface transport errors.
      }
    })();

    await expect(stream).rejects.toMatchObject({
      code: "stream_gap",
      status: 409,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  return input instanceof URL ? input.href : input.url;
}

function sandboxBody(overrides: Record<string, unknown> = {}) {
  return {
    expiresAt: "2026-06-09T15:30:00.000Z",
    id: "sbx_123",
    metadata: {},
    orgId: "org_123",
    projectId: "prj_123",
    status: "ready",
    templateId: "tpl_python_node",
    templateSlug: "python-node",
    templateVersion: "2026-06-01",
    templateVersionId: "tplv_123",
    ttlMs: 3_600_000,
    ...overrides,
  };
}

function commandResponse(status: "running"): Response {
  return jsonResponse({
    command: { ...terminalCommand(), status },
  });
}

function terminalCommand() {
  return {
    command: "npm test",
    cwd: "/workspace",
    env: {},
    exitCode: 0,
    id: "cmd_123",
    sandboxId: "sbx_123",
    status: "exited",
  };
}

function commandStreamWithTerminalResponse(): Response {
  return new Response(
    [
      'data: {"type":"log","seq":1,"stream":"stdout","data":"out\\n","createdAt":"now"}',
      "",
      'data: {"type":"log","seq":2,"stream":"stderr","data":"err\\n","createdAt":"now"}',
      "",
      `data: ${JSON.stringify({ command: terminalCommand(), createdAt: "now", type: "terminal" })}`,
      "",
      "",
    ].join("\n"),
    { headers: { "content-type": "text/event-stream" } },
  );
}

function reconnectedCommandStreamResponse(): Response {
  return new Response(
    [
      'data: {"type":"log","seq":2,"stream":"stdout","data":"again\\n","createdAt":"now"}',
      "",
      `data: ${JSON.stringify({ command: terminalCommand(), createdAt: "now", type: "terminal" })}`,
      "",
      "",
    ].join("\n"),
    { headers: { "content-type": "text/event-stream" } },
  );
}

function commandLogsResponse(): Response {
  return jsonResponse({
    data: [
      {
        commandId: "cmd_123",
        createdAt: "now",
        data: "collected\n",
        seq: 1,
        stream: "stdout",
      },
    ],
    hasMore: false,
  });
}

function erroringCommandStreamResponse(): Response {
  let sent = false;
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent) {
          throw new Error("network reset");
        }
        sent = true;
        controller.enqueue(
          new TextEncoder().encode(
            'data: {"type":"log","seq":1,"stream":"stdout","data":"ready\\n","createdAt":"now"}\n\n',
          ),
        );
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}

function heartbeatThenInvalidJsonStreamResponse(): Response {
  return new Response(
    ['data: {"type":"heartbeat","createdAt":"now"}', "", 'data: {"type"', "", ""].join(
      "\n",
    ),
    { headers: { "content-type": "text/event-stream" } },
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

/* eslint-enable max-lines -- End grouped SDK parity cases. */
