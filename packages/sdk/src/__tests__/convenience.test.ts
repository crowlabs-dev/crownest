import { describe, expect, it, vi } from "vitest";

import { createCrowNestClient } from "../index";

describe("one-shot workspace runs", () => {
  it("uses direct upload at or below the 8 MiB threshold", async () => {
    const run = { id: "wsr_test", status: "awaiting_archive" };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ workspaceRun: run }))
      .mockResolvedValueOnce(
        jsonResponse({
          archive: {},
          workspaceRun: { ...run, status: "archive_uploaded" },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ workspaceRun: { ...run, status: "running" } }),
      );
    const client = createCrowNestClient({
      apiKey: "cnk_test_key",
      baseUrl: "https://api.test",
      fetch: fetchMock,
    });

    await expect(
      client.workspaceRuns.run({
        archive: { body: new Uint8Array([1, 2, 3]), sha256: "abc", sizeBytes: 3 },
        command: "pnpm test",
      }),
    ).resolves.toMatchObject({ id: "wsr_test", status: "running" });

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "https://api.test/v1/workspace-runs",
      "https://api.test/v1/workspace-runs/wsr_test/archive",
      "https://api.test/v1/workspace-runs/wsr_test/start",
    ]);
  });
});

describe("one-shot workspace runs above the direct-upload threshold", () => {
  it("uses staged transfer above 8 MiB and can wait for terminal state", async () => {
    const run = { id: "wsr_test", status: "awaiting_archive" };
    const transfer = {
      headers: { "x-upload-token": "token" },
      id: "upl_test",
      uploadUrl: "https://uploads.test/upl_test",
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ workspaceRun: run }))
      .mockResolvedValueOnce(jsonResponse({ transfer }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        jsonResponse({
          archive: {},
          workspaceRun: { ...run, status: "archive_uploaded" },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ workspaceRun: { ...run, status: "running" } }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ workspaceRun: { ...run, status: "succeeded" } }),
      );
    const client = createCrowNestClient({
      apiKey: "cnk_test_key",
      baseUrl: "https://api.test",
      fetch: fetchMock,
    });

    await expect(
      client.workspaceRuns.run({
        archive: {
          body: new Uint8Array([1]),
          sha256: "abc",
          sizeBytes: 8 * 1024 * 1024 + 1,
        },
        command: "pnpm test",
        wait: true,
        waitOptions: { intervalMs: 0 },
      }),
    ).resolves.toMatchObject({ id: "wsr_test", status: "succeeded" });

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "https://api.test/v1/workspace-runs",
      "https://api.test/v1/workspace-runs/wsr_test/archive-transfer",
      "https://uploads.test/upl_test",
      "https://api.test/v1/workspace-runs/wsr_test/archive/finalize",
      "https://api.test/v1/workspace-runs/wsr_test/start",
      "https://api.test/v1/workspace-runs/wsr_test",
    ]);
  });
});

describe("command waits", () => {
  it("polls with backoff until the command reaches a terminal state", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ command: { id: "cmd_test", status: "running" } }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ command: { id: "cmd_test", status: "exited" } }),
      );
    const client = createCrowNestClient({ apiKey: "cnk_test_key", fetch: fetchMock });

    await expect(
      client.commands.wait("cmd_test", { intervalMs: 0, timeoutMs: 1_000 }),
    ).resolves.toMatchObject({ id: "cmd_test", status: "exited" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  });
}
