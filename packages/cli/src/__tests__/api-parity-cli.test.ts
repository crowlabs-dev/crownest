import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { runCli } from "../index";

const environment = {
  CROWNEST_API_KEY: "cn_live_abcdefghij_secret",
  CROWNEST_API_URL: "https://api.test",
} as const;

const tempPaths: string[] = [];

afterEach(() => {
  for (const path of tempPaths.splice(0))
    rmSync(path, { force: true, recursive: true });
});

// eslint-disable-next-line max-lines-per-function -- One transport-oriented parity matrix keeps the fixtures local.
describe("API parity CLI commands", () => {
  it("prints usage in human and JSON modes", async () => {
    const usage = usageBody();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(() => Promise.resolve(jsonResponse(usage)));

    const human = await runCli(["usage"], environment, fetchMock);
    const json = await runCli(["usage", "--json"], environment, fetchMock);

    expect(human).toMatchObject({ exitCode: 0, stderr: "" });
    expect(human.stdout).toContain('credits: {"remaining":6,"used":4}');
    expect(human.stdout).toContain('quotas: {"sandboxes"');
    expect(JSON.parse(json.stdout)).toEqual({ data: usage });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.test/v1/usage");
  });

  it("gets one sandbox and one command", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ sandbox: sandboxBody() }))
      .mockResolvedValueOnce(jsonResponse({ command: commandBody({ exitCode: 7 }) }));

    const sandbox = await runCli(
      ["sandboxes", "get", "sbx_123", "--json"],
      environment,
      fetchMock,
    );
    const command = await runCli(
      ["commands", "get", "cmd_123", "--json"],
      environment,
      fetchMock,
    );

    expect(JSON.parse(sandbox.stdout)).toMatchObject({ data: { id: "sbx_123" } });
    expect(JSON.parse(command.stdout)).toMatchObject({
      data: { exitCode: 7, id: "cmd_123", stderr: "warning\n", stdout: "done\n" },
    });
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "https://api.test/v1/sandboxes/sbx_123",
      "https://api.test/v1/commands/cmd_123",
    ]);
  });

  it("writes stdin exactly, keeps dash-prefixed positional content, and reads --file", async () => {
    const localDir = temporaryDirectory();
    const localFile = join(localDir, "input.txt");
    writeFileSync(localFile, "from file\n");
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse({ file: { path: "/workspace/a", sizeBytes: 1, type: "file" } }),
      );

    await runCli(
      ["files", "write", "sbx_123", "/workspace/a", "-"],
      environment,
      fetchMock,
      undefined,
      ["one\n", "two\n"],
    );
    await runCli(
      ["files", "write", "sbx_123", "/workspace/a", "- item"],
      environment,
      fetchMock,
    );
    await runCli(
      ["files", "write", "sbx_123", "/workspace/a", "--literal-content"],
      environment,
      fetchMock,
    );
    await runCli(
      ["files", "write", "sbx_123", "/workspace/a", "--file", localFile],
      environment,
      fetchMock,
    );

    expect(requestBodies(fetchMock)).toEqual([
      expect.objectContaining({ content: "one\ntwo\n" }),
      expect.objectContaining({ content: "- item" }),
      expect.objectContaining({ content: "--literal-content" }),
      expect.objectContaining({ content: "from file\n" }),
    ]);
  });

  it("downloads exact bytes, supports default basename, and rejects two destinations", async () => {
    const directory = temporaryDirectory();
    const explicitPath = join(directory, "explicit.bin");
    const bytes = Uint8Array.from([0, 255, 10, 128, 42]);
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(() =>
      Promise.resolve(
        jsonResponse({
          content: Buffer.from(bytes).toString("base64"),
          encoding: "base64",
        }),
      ),
    );

    const explicit = await runCli(
      ["files", "download", "sbx_123", "/workspace/blob.bin", explicitPath],
      environment,
      fetchMock,
    );
    expect(explicit.exitCode).toBe(0);
    expect(readFileSync(explicitPath)).toEqual(Buffer.from(bytes));

    const oldCwd = process.cwd();
    process.chdir(directory);
    try {
      const defaulted = await runCli(
        ["files", "download", "sbx_123", "/workspace/default.bin"],
        environment,
        fetchMock,
      );
      expect(defaulted.exitCode).toBe(0);
      expect(readFileSync(join(directory, "default.bin"))).toEqual(Buffer.from(bytes));
    } finally {
      process.chdir(oldCwd);
    }

    const ambiguous = await runCli(
      [
        "files",
        "download",
        "sbx_123",
        "/workspace/blob.bin",
        explicitPath,
        "--output",
        join(directory, "other.bin"),
      ],
      environment,
      fetchMock,
    );
    expect(ambiguous.exitCode).toBe(2);
    expect(ambiguous.stderr).toContain("positionally or with --output");
    expect(fetchMock.mock.calls[0]?.[0]).toContain("encoding=base64");
  });

  it("passes through command exit codes and clamps values above 125", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ command: commandBody({ exitCode: 7 }) }))
      .mockResolvedValueOnce(jsonResponse({ command: commandBody({ exitCode: 130 }) }));

    const seven = await runCli(
      ["commands", "run", "sbx_123", "--json", "--", "false"],
      environment,
      fetchMock,
    );
    const clamped = await runCli(
      ["commands", "run", "sbx_123", "--", "false"],
      environment,
      fetchMock,
    );

    expect(seven.exitCode).toBe(7);
    expect(JSON.parse(seven.stdout)).toMatchObject({ data: { exitCode: 7 } });
    expect(clamped.exitCode).toBe(125);

    const usage = await runCli(["commands", "run", "sbx_123"], environment, vi.fn());
    expect(usage.exitCode).toBe(2);
    const api = await runCli(
      ["commands", "run", "sbx_123", "--", "false"],
      environment,
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(errorResponse(500, "internal_error", "Failed.")),
    );
    expect(api.exitCode).toBe(1);
  });

  it("paginates list commands, preserves page metadata, and guards broken cursors", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ data: [{ id: "sbx_1" }], hasMore: true, nextCursor: "next" }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: "sbx_2" }], hasMore: false }));

    const all = await runCli(
      ["sandboxes", "list", "--limit", "2", "--cursor", "start", "--all", "--json"],
      environment,
      fetchMock,
    );

    expect(JSON.parse(all.stdout)).toEqual({
      data: [{ id: "sbx_1" }, { id: "sbx_2" }],
      hasMore: false,
    });
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "https://api.test/v1/sandboxes?limit=2&cursor=start",
      "https://api.test/v1/sandboxes?limit=2&cursor=next",
    ]);

    const broken = await runCli(
      ["projects", "list", "--all", "--json"],
      environment,
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(jsonResponse({ data: [], hasMore: true })),
    );
    expect(broken.exitCode).toBe(1);
    expect(broken.stderr).toContain("without a new nextCursor");

    const invalid = await runCli(
      ["sandboxes", "list", "--limit", "501"],
      environment,
      vi.fn(),
    );
    expect(invalid.exitCode).toBe(2);
    expect(invalid.stderr).toContain("1 to 500");
  });

  it("sends pagination flags for every paginated list surface", async () => {
    const cases = [
      {
        argv: ["projects", "list", "--limit", "3", "--cursor", "c"],
        url: "https://api.test/v1/projects?limit=3&cursor=c",
      },
      {
        argv: ["artifacts", "list", "sbx_123", "--limit", "3", "--cursor", "c"],
        url: "https://api.test/v1/sandboxes/sbx_123/artifacts?limit=3&cursor=c",
      },
      {
        argv: ["previews", "list", "sbx_123", "--limit", "3", "--cursor", "c"],
        url: "https://api.test/v1/sandboxes/sbx_123/previews?limit=3&cursor=c",
      },
      {
        argv: ["workspace-runs", "list", "--limit", "3", "--cursor", "c"],
        url: "https://api.test/v1/workspace-runs?limit=3&cursor=c",
      },
    ] as const;

    for (const testCase of cases) {
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(jsonResponse({ data: [], hasMore: false }));
      const result = await runCli(testCase.argv, environment, fetchMock);
      expect(result.exitCode, testCase.argv.join(" ")).toBe(0);
      expect(fetchMock.mock.calls[0]?.[0]).toBe(testCase.url);
    }

    const keyFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ data: [], hasMore: false }));
    const keys = await runCli(
      ["keys", "list", "--limit", "3", "--cursor", "c"],
      {
        CROWNEST_API_URL: "https://api.test",
        CROWNEST_ORG_ID: "org_123",
        CROWNEST_ROLE: "owner",
        CROWNEST_USER_ID: "usr_123",
      },
      keyFetch,
    );
    expect(keys.exitCode).toBe(0);
    expect(keyFetch.mock.calls[0]?.[0]).toBe(
      "https://api.test/v1/api-keys?limit=3&cursor=c",
    );
  });
});

function temporaryDirectory(): string {
  const path = mkdtempSync(join(tmpdir(), "crownest-cli-parity-"));
  tempPaths.push(path);
  return path;
}

function requestBodies(
  fetchMock: ReturnType<typeof vi.fn<typeof fetch>>,
): readonly unknown[] {
  return fetchMock.mock.calls.map(
    (call) => JSON.parse(call[1]?.body as string) as unknown,
  );
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status: 200,
  });
}

function errorResponse(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function usageBody() {
  return {
    computeUnitSeconds: { used: 40 },
    computeUnitSecondsPerCredit: 10,
    credits: { remaining: 6, used: 4 },
    currencyPerCredit: 0.01,
    period: {
      end: "2026-08-01T00:00:00.000Z",
      resetAt: "2026-08-01T00:00:00.000Z",
      start: "2026-07-01T00:00:00.000Z",
    },
    pricingVersion: "2026-07",
    quotas: { sandboxes: { current: 1, limit: 3, remaining: 2 } },
  };
}

function sandboxBody() {
  return {
    expiresAt: "2026-07-10T20:00:00.000Z",
    id: "sbx_123",
    metadata: {},
    orgId: "org_123",
    projectId: "prj_123",
    status: "ready",
    templateId: "tpl_123",
    templateSlug: "python-node",
    templateVersion: "1",
    templateVersionId: "tplv_123",
    ttlMs: 3_600_000,
  };
}

function commandBody(overrides: Record<string, unknown> = {}) {
  return {
    command: "false",
    createdAt: "2026-07-10T18:00:00.000Z",
    exitCode: 0,
    id: "cmd_123",
    sandboxId: "sbx_123",
    status: "exited",
    stderr: "warning\n",
    stdout: "done\n",
    updatedAt: "2026-07-10T18:00:01.000Z",
    ...overrides,
  };
}
