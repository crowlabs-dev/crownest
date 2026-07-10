/* eslint-disable max-lines-per-function -- Shell protocol tests keep request and stream fixtures together. */
import { describe, expect, it, vi } from "vitest";

import { runCli } from "../index";

const testEnv = {
  CROWNEST_API_KEY: "cn_live_test",
  CROWNEST_API_URL: "https://api.test",
} as const;

describe("crownest shell", () => {
  registerCodeShellTests();
  registerBashShellTests();
});

function registerCodeShellTests() {
  it("keeps Python code shell state in one context", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ context: codeContext("python") }))
      .mockResolvedValueOnce(sseResponse(completeEvent({ executionCount: 1 })))
      .mockResolvedValueOnce(
        sseResponse(completeEvent({ executionCount: 2, stdout: "42\n" })),
      )
      .mockResolvedValueOnce(jsonResponse({ context: codeContext("python") }));

    const result = await runCli(["shell", "sbx_123"], testEnv, fetchMock, undefined, [
      "x = 41\n",
      "print(x + 1)\n",
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("variables persist");
    expect(result.stdout).toContain("42\n");
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "https://api.test/v1/sandboxes/sbx_123/code/contexts",
      "https://api.test/v1/sandboxes/sbx_123/code/runs/stream",
      "https://api.test/v1/sandboxes/sbx_123/code/runs/stream",
      "https://api.test/v1/sandboxes/sbx_123/code/contexts/cctx_123",
    ]);
    expect(requestBody(fetchMock, 1)).toEqual({
      code: "x = 41",
      contextId: "cctx_123",
      language: "python",
    });
    expect(requestBody(fetchMock, 2)).toEqual({
      code: "print(x + 1)",
      contextId: "cctx_123",
      language: "python",
    });
  });

  it("prints code execution errors and keeps the shell open", async () => {
    const executionError = {
      message: "bad",
      name: "ValueError",
      traceback: ["line 1"],
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ context: codeContext("python") }))
      .mockResolvedValueOnce(
        sseResponse(
          sseEvent("error", { data: executionError, type: "error" }),
          completeEvent({ error: executionError, executionCount: 1 }),
        ),
      )
      .mockResolvedValueOnce(
        sseResponse(completeEvent({ executionCount: 2, stdout: "ok\n" })),
      )
      .mockResolvedValueOnce(jsonResponse({ context: codeContext("python") }));

    const result = await runCli(["shell", "sbx_123"], testEnv, fetchMock, undefined, [
      "raise ValueError('bad')\n",
      "print('ok')\n",
    ]);

    expect(result).toMatchObject({ exitCode: 0 });
    expect(result.stderr).toBe("ValueError: bad\nline 1\n");
    expect(result.stdout).toContain("ok\n");
  });

  it("deletes the code context when the user exits", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ context: codeContext("typescript") }))
      .mockResolvedValueOnce(jsonResponse({ context: codeContext("typescript") }));

    const result = await runCli(
      ["shell", "sbx_123", "--lang", "typescript"],
      testEnv,
      fetchMock,
      undefined,
      ["exit\n"],
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("typescript");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://api.test/v1/sandboxes/sbx_123/code/contexts/cctx_123",
    );
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "DELETE" });
  });

  it("prints structured API errors when context creation fails", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(
          { error: { code: "sandbox_not_found", message: "Sandbox not found." } },
          404,
        ),
      );

    const result = await runCli(
      ["shell", "sbx_missing"],
      testEnv,
      fetchMock,
      undefined,
      ["print('never')\n"],
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("error[sandbox_not_found]: Sandbox not found.");
    expect(result.stderr).toContain("status: 404");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
}

function registerBashShellTests() {
  it("continues after nonzero bash commands", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          command: commandResult({ command: "false", exitCode: 2, stderr: "bad\n" }),
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          command: commandResult({ command: "echo ok", exitCode: 0, stdout: "ok\n" }),
        }),
      );

    const result = await runCli(
      ["shell", "sbx_123", "--bash"],
      testEnv,
      fetchMock,
      undefined,
      ["false\n", "echo ok\n"],
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("each line runs independently");
    expect(result.stdout).toContain("ok\n");
    expect(result.stderr).toBe("bad\n[exit 2]\n");
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "https://api.test/v1/sandboxes/sbx_123/commands",
      "https://api.test/v1/sandboxes/sbx_123/commands",
    ]);
    expect(requestBody(fetchMock, 0)).toEqual({ command: "false" });
    expect(requestBody(fetchMock, 1)).toEqual({ command: "echo ok" });
  });

  it("rejects --lang with --bash before making a request", async () => {
    const fetchMock = vi.fn<typeof fetch>();

    const result = await runCli(
      ["shell", "sbx_123", "--lang", "python", "--bash"],
      testEnv,
      fetchMock,
      undefined,
      ["echo skipped\n"],
    );

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe("--lang cannot be used with --bash.\n");
    expect(fetchMock).not.toHaveBeenCalled();
  });
}

function codeContext(language: "javascript" | "python" | "typescript") {
  return {
    createdAt: "2026-06-14T12:00:00.000Z",
    cwd: "/workspace",
    id: "cctx_123",
    language,
    sandboxId: "sbx_123",
  };
}

function commandResult(input: {
  readonly command: string;
  readonly exitCode: number;
  readonly stderr?: string;
  readonly stdout?: string;
}) {
  return {
    command: input.command,
    cwd: "/workspace",
    env: {},
    exitCode: input.exitCode,
    id: "cmd_123",
    sandboxId: "sbx_123",
    status: "exited",
    stderr: input.stderr ?? "",
    stdout: input.stdout ?? "",
  };
}

function completeEvent(
  data: Partial<{
    readonly error: unknown;
    readonly executionCount: number;
    readonly stderr: string;
    readonly stdout: string;
  }>,
) {
  return sseEvent("complete", {
    data: {
      contextId: "cctx_123",
      executionCount: 1,
      language: "python",
      outputs: [],
      sandboxId: "sbx_123",
      stderr: "",
      stdout: "",
      ...data,
    },
    type: "complete",
  });
}

function requestBody(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>, index: number) {
  const body = fetchMock.mock.calls[index]?.[1]?.body;
  expect(typeof body).toBe("string");
  return JSON.parse(body as string) as unknown;
}

function sseEvent(type: string, event: unknown) {
  return `event: ${type}\ndata: ${JSON.stringify(event)}\n\n`;
}

function sseResponse(...events: readonly string[]) {
  return new Response(events.join(""), {
    headers: { "content-type": "text/event-stream" },
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

/* eslint-enable max-lines-per-function -- End shell protocol fixtures. */
