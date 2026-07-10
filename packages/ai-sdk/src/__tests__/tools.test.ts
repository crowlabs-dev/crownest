import { describe, expect, it, vi } from "vitest";

import type { CrownestToolsClient } from "../session";
import { crownestTools, killSession } from "../tools";

describe("crownestTools", () => {
  registerSandboxLifecycleTests();
  registerSandboxReplacementTests();
  registerCodeResultTests();
  registerWorkspaceFileTests();
});

function registerSandboxLifecycleTests(): void {
  it("creates one lazy sandbox and reuses it across commands", async () => {
    const { client, commandsRun, sandboxesCreate, sandboxesKill } = mockClient();
    const tools = crownestTools({ client, template: "python-node", ttlMs: 120_000 });

    await executeTool(tools.runCommand, { command: "pwd" });
    await executeTool(tools.runCommand, { command: "python main.py" });
    await killSession(tools);

    expect(sandboxesCreate).toHaveBeenCalledTimes(1);
    expect(sandboxesCreate).toHaveBeenCalledWith({
      template: "python-node",
      ttlMs: 120_000,
    });
    expect(commandsRun.mock.calls.map((call) => call[0])).toEqual([
      "sbx_lazy",
      "sbx_lazy",
    ]);
    expect(sandboxesKill).toHaveBeenCalledWith("sbx_lazy");
  });

  it("uses a pinned sandbox without creating or killing one", async () => {
    const { client, commandsRun, sandboxesCreate, sandboxesKill } = mockClient();
    const tools = crownestTools({ client, sandboxId: "sbx_pinned" });

    await executeTool(tools.runCommand, { command: "pwd" });
    await killSession(tools);

    expect(sandboxesCreate).not.toHaveBeenCalled();
    expect(sandboxesKill).not.toHaveBeenCalled();
    expect(commandsRun.mock.calls[0]?.[0]).toBe("sbx_pinned");
  });

  it("keeps auto-created sandbox cleanup retryable after a kill failure", async () => {
    const { client, sandboxesKill } = mockClient();
    const tools = crownestTools({ client });
    sandboxesKill.mockRejectedValueOnce(new Error("network"));

    await executeTool(tools.runCommand, { command: "pwd" });

    await expect(killSession(tools)).rejects.toThrow("network");
    await killSession(tools);

    expect(sandboxesKill).toHaveBeenCalledTimes(2);
    expect(sandboxesKill).toHaveBeenNthCalledWith(2, "sbx_lazy");
  });
}

function registerSandboxReplacementTests(): void {
  it("creates a replacement lazy sandbox after TTL expiry", async () => {
    vi.useFakeTimers();

    try {
      vi.setSystemTime(new Date("2026-06-14T12:00:00.000Z"));
      const { client, commandsRun, sandboxesCreate } = mockClient();
      const tools = crownestTools({ client });
      sandboxesCreate.mockResolvedValueOnce(
        sandboxFixture({ expiresAt: "2026-06-14T12:15:00.000Z" }),
      );

      await executeTool(tools.runCommand, { command: "pwd" });

      vi.setSystemTime(new Date("2026-06-14T12:16:00.000Z"));
      sandboxesCreate.mockResolvedValueOnce(
        sandboxFixture({
          expiresAt: "2026-06-14T12:45:00.000Z",
          id: "sbx_next",
        }),
      );

      await executeTool(tools.runCommand, { command: "ls" });

      expect(sandboxesCreate).toHaveBeenCalledTimes(2);
      expect(commandsRun.mock.calls.map((call) => call[0])).toEqual([
        "sbx_lazy",
        "sbx_next",
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("creates a replacement lazy sandbox after sandbox_destroyed", async () => {
    const { client, commandsRun, sandboxesCreate } = mockClient();
    const tools = crownestTools({ client });
    commandsRun.mockRejectedValueOnce(apiError("sandbox_destroyed"));

    await expect(
      executeTool(tools.runCommand, { command: "pwd" }),
    ).rejects.toMatchObject({ code: "sandbox_destroyed" });

    sandboxesCreate.mockResolvedValueOnce(
      sandboxFixture({
        expiresAt: "2026-06-14T12:45:00.000Z",
        id: "sbx_next",
      }),
    );

    await executeTool(tools.runCommand, { command: "ls" });

    expect(sandboxesCreate).toHaveBeenCalledTimes(2);
    expect(commandsRun.mock.calls.map((call) => call[0])).toEqual([
      "sbx_lazy",
      "sbx_next",
    ]);
  });
}

function registerCodeResultTests(): void {
  it("returns traceback text for Code Run errors", async () => {
    const { client, codeRun } = mockClient();
    codeRun.mockResolvedValueOnce({
      contextId: "cctx_123",
      error: {
        message: "division by zero",
        name: "ZeroDivisionError",
        traceback: ["Traceback (most recent call last):", "ZeroDivisionError"],
      },
      executionCount: 1,
      language: "python",
      outputs: [],
      sandboxId: "sbx_lazy",
      stderr: "",
      stdout: "",
    });
    const tools = crownestTools({ client });

    const result = await executeTool(tools.runCode, { code: "1 / 0" });

    expect(result).toContain("error:");
    expect(result).toContain("ZeroDivisionError");
    expect(result).toContain("Traceback (most recent call last):");
  });
}

function registerWorkspaceFileTests(): void {
  it("round-trips writeFile and readFile through the same lazy sandbox", async () => {
    const { client } = mockClient();
    const tools = crownestTools({ client });

    const write = await executeTool(tools.writeFile, {
      content: "hello from crownest",
      path: "/workspace/notes.txt",
    });
    const read = await executeTool(tools.readFile, {
      path: "/workspace/notes.txt",
    });

    expect(write).toContain("path: /workspace/notes.txt");
    expect(read).toContain("content:\nhello from crownest");
  });

  it("truncates oversized readFile results", async () => {
    const { client } = mockClient();
    const tools = crownestTools({ client });

    await executeTool(tools.writeFile, {
      content: "abcdef",
      path: "/workspace/large.txt",
    });
    const read = await executeTool(tools.readFile, {
      maxBytes: 3,
      path: "/workspace/large.txt",
    });

    expect(read).toContain("content_bytes: 6");
    expect(read).toContain("truncated: true");
    expect(read).toContain("content:\nabc");
    expect(read).toContain("[truncated after 3 bytes]");
  });

  it("serializes concurrent tool calls against one workspace", async () => {
    const { client, filesRead, releaseWrite } = mockClient({ pauseWrites: true });
    const tools = crownestTools({ client });

    const write = executeTool(tools.writeFile, {
      content: "ready",
      path: "/workspace/state.txt",
    });
    const read = executeTool(tools.readFile, {
      path: "/workspace/state.txt",
    });

    await Promise.resolve();
    expect(filesRead).not.toHaveBeenCalled();

    releaseWrite();

    await expect(write).resolves.toContain("path: /workspace/state.txt");
    await expect(read).resolves.toContain("content:\nready");
  });
}

type ExecutableTool = {
  readonly execute?: (input: unknown, options: unknown) => unknown;
};

async function executeTool(candidate: unknown, input: unknown): Promise<string> {
  const executable = candidate as ExecutableTool;
  if (executable.execute === undefined) {
    throw new Error("Tool is missing execute");
  }

  const result = await executable.execute(input, { toolCallId: "call_test" });
  if (typeof result !== "string") {
    throw new TypeError("Expected tool result to be a string");
  }
  return result;
}

function mockClient(options: { readonly pauseWrites?: boolean } = {}) {
  const files = new Map<string, string>();
  const writeGate = options.pauseWrites ? deferred() : openGate();
  const sandboxesCreate = mockSandboxesCreate();
  const sandboxesKill = mockSandboxesKill();
  const commandsRun = mockCommandsRun();
  const codeRun = mockCodeRun();
  const filesRead = mockFilesRead(files);
  const filesWrite = mockFilesWrite(files, writeGate);
  const client = {
    code: { run: codeRun },
    commands: { run: commandsRun },
    files: { read: filesRead, write: filesWrite },
    sandboxes: { create: sandboxesCreate, kill: sandboxesKill },
  } satisfies CrownestToolsClient;

  return {
    client,
    codeRun,
    commandsRun,
    filesRead,
    filesWrite,
    releaseWrite: writeGate.resolve,
    sandboxesCreate,
    sandboxesKill,
  };
}

function mockSandboxesCreate() {
  return vi.fn(() => Promise.resolve(sandboxFixture()));
}

function mockSandboxesKill() {
  return vi.fn((sandboxId: `sbx_${string}`) =>
    Promise.resolve(sandboxFixture({ id: sandboxId, status: "destroyed" })),
  );
}

function mockCommandsRun() {
  return vi.fn((sandboxId: `sbx_${string}`, command: string) =>
    Promise.resolve({
      command,
      cwd: "/workspace",
      env: {},
      exitCode: 0,
      id: "cmd_123" as const,
      sandboxId,
      status: "exited",
      stderr: "",
      stdout: `ran ${command}`,
    }),
  );
}

function mockCodeRun() {
  return vi.fn(
    (
      sandboxId: `sbx_${string}`,
      input: { readonly code: string },
    ): Promise<CodeRunFixture> =>
      Promise.resolve({
        contextId: "cctx_123",
        executionCount: 1,
        language: "python",
        outputs: [],
        sandboxId,
        stderr: "",
        stdout: `ran ${input.code}`,
      }),
  );
}

function mockFilesRead(files: ReadonlyMap<string, string>) {
  return vi.fn((sandboxId: `sbx_${string}`, path: string) =>
    Promise.resolve(files.get(`${sandboxId}:${path}`) ?? ""),
  );
}

function mockFilesWrite(files: Map<string, string>, writeGate: WriteGate) {
  return vi.fn(async (sandboxId: `sbx_${string}`, path: string, content: string) => {
    await writeGate.promise;
    files.set(`${sandboxId}:${path}`, content);
    return {
      path,
      sizeBytes: new TextEncoder().encode(content).byteLength,
      type: "file",
    };
  });
}

function openGate(): WriteGate {
  return {
    promise: Promise.resolve(),
    resolve: () => undefined,
  };
}

function deferred(): WriteGate {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function sandboxFixture(input: Partial<SandboxFixture> = {}): SandboxFixture {
  return {
    expiresAt: "2099-06-14T12:15:00.000Z",
    id: "sbx_lazy",
    status: "running",
    ...input,
  };
}

function apiError(code: string): Error & { readonly code: string } {
  return Object.assign(new Error(code), { code });
}

type WriteGate = {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
};

type SandboxFixture = {
  readonly expiresAt: string;
  readonly id: `sbx_${string}`;
  readonly status: string;
};

type CodeRunFixture = {
  readonly contextId: `cctx_${string}`;
  readonly error?: {
    readonly message: string;
    readonly name?: string;
    readonly traceback?: readonly string[];
  };
  readonly executionCount: number;
  readonly language: "python";
  readonly outputs: readonly [];
  readonly sandboxId: `sbx_${string}`;
  readonly stderr: string;
  readonly stdout: string;
};
