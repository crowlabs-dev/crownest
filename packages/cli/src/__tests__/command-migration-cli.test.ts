import { describe, expect, it, vi } from "vitest";

import { runCli } from "../index";

const environment = {
  CROWNEST_API_KEY: "cn_live_test",
  CROWNEST_API_URL: "https://api.test",
} as const;

describe("canonical command execution CLI", () => {
  it("starts background commands through the canonical endpoint and exits zero", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        command: {
          command: "npm start",
          exitCode: 99,
          id: "cmd_123",
          sandboxId: "sbx_123",
          status: "running",
        },
      }),
    );

    const result = await runCli(
      ["commands", "run", "sbx_123", "--background", "--json", "--", "npm", "start"],
      environment,
      fetchMock,
    );

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      data: { id: "cmd_123", status: "running" },
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://api.test/v1/sandboxes/sbx_123/commands",
    );
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toEqual({
      background: true,
      command: "npm start",
    });
    expect(postedIdempotencyKey(fetchMock)).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("canonical request idempotency", () => {
  it("sends an idempotency key on canonical mutating requests", async () => {
    const commandFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        command: {
          command: "true",
          exitCode: 0,
          id: "cmd_123",
          sandboxId: "sbx_123",
          status: "exited",
        },
      }),
    );
    await runCli(
      ["commands", "run", "sbx_123", "--json", "--", "true"],
      environment,
      commandFetch,
    );
    expect(postedIdempotencyKey(commandFetch)).toMatch(/^[0-9a-f-]{36}$/);

    const ttlFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        sandbox: {
          expiresAt: "2026-06-09T16:00:00.000Z",
          id: "sbx_123",
          status: "ready",
          ttlMs: 5_400_000,
        },
      }),
    );
    await runCli(
      ["sandboxes", "set-ttl", "sbx_123", "--ttl-ms", "5400000"],
      environment,
      ttlFetch,
    );
    expect(postedIdempotencyKey(ttlFetch)).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("canonical command validation", () => {
  it("rejects background collection before fetching", async () => {
    const cases = [
      [
        "commands",
        "run",
        "sbx_123",
        "--background",
        "--collect",
        "/workspace/out",
        "--",
        "true",
      ],
      [
        "commands",
        "run",
        "sbx_123",
        "--background",
        "--collect-on",
        "always",
        "--",
        "true",
      ],
    ] as const;

    for (const argv of cases) {
      const fetchMock = vi.fn<typeof fetch>();
      const result = await runCli(argv, environment, fetchMock);
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("--background cannot be used with");
      expect(fetchMock).not.toHaveBeenCalled();
    }
  });

  it("rejects removed pre-launch command forms without fetching", async () => {
    const cases = [
      ["commands", "start", "sbx_123", "--", "true"],
      ["sandboxes", "extend", "sbx_123", "--ttl-ms", "1000"],
    ] as const;

    for (const argv of cases) {
      const fetchMock = vi.fn<typeof fetch>();
      const result = await runCli(argv, environment, fetchMock);
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("Unknown command");
      expect(fetchMock).not.toHaveBeenCalled();
    }
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status: 202,
  });
}

function postedIdempotencyKey(
  fetchMock: ReturnType<typeof vi.fn<typeof fetch>>,
): string {
  const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
  return headers.get("idempotency-key") ?? "";
}
