import { describe, expect, it } from "vitest";

import { callTool, createHarness, createSandboxHandle, text } from "./mcp-test-helpers";

describe("run_command", () => {
  it("runs Commands with optional cwd and timeout", async () => {
    const sandbox = createSandboxHandle("sbx_command");
    sandbox.mocks.commandRun.mockResolvedValueOnce(commandResult("sbx_command"));
    const { tools } = createHarness([sandbox]);

    const result = await callTool(tools, "run_command", {
      command: "pwd",
      cwd: "/workspace/app",
      timeout_ms: 500,
    });

    expect(sandbox.mocks.commandRun).toHaveBeenCalledWith("pwd", {
      cwd: "/workspace/app",
      timeoutMs: 500,
    });
    expect(text(result)).toContain("command_id: cmd_123");
    expect(text(result)).toContain("status: exited");
    expect(text(result)).toContain("exit_code: 0");
    expect(text(result)).toContain("stdout:\n");
    expect(text(result)).toContain("stderr:\n");
  });

  it("runs Commands in the background without waiting for completion", async () => {
    const sandbox = createSandboxHandle("sbx_command");
    sandbox.mocks.commandRun.mockResolvedValueOnce({
      ...commandResult("sbx_command"),
      status: "running",
    });
    const { tools } = createHarness([sandbox]);

    const result = await callTool(tools, "run_command", {
      background: true,
      command: "pnpm test",
      cwd: "/workspace/app",
      timeout_ms: 500,
    });

    expect(sandbox.mocks.commandRun).toHaveBeenCalledWith("pnpm test", {
      background: true,
      cwd: "/workspace/app",
      timeoutMs: 500,
    });
    expect(text(result)).toContain('"command_id": "cmd_123"');
    expect(text(result)).toContain('"status": "running"');
  });
});

describe("Workspace read/write tools", () => {
  it("writes, reads, and lists Workspace files", async () => {
    const sandbox = createSandboxHandle("sbx_files");
    sandbox.mocks.fileWrite.mockResolvedValueOnce(fileStat());
    sandbox.mocks.fileRead.mockResolvedValueOnce("hello");
    sandbox.mocks.fileList.mockResolvedValueOnce({
      data: [fileEntry()],
      hasMore: false,
    });
    const { tools } = createHarness([sandbox]);

    await callTool(tools, "write_file", fileInput());
    const read = await callTool(tools, "read_file", { path: "/workspace/a.txt" });
    const list = await callTool(tools, "list_files", { path: "/workspace" });

    expect(sandbox.mocks.fileWrite).toHaveBeenCalledWith("/workspace/a.txt", "hello", {
      encoding: "utf8",
    });
    expect(sandbox.mocks.fileRead).toHaveBeenCalledWith("/workspace/a.txt", {
      encoding: "utf8",
    });
    expect(sandbox.mocks.fileList).toHaveBeenCalledWith("/workspace");
    expect(text(read)).toContain('"content": "hello"');
    expect(text(list)).toContain('"sandbox_id": "sbx_files"');
  });

  it("writes, reads, and links binary Workspace files", async () => {
    const sandbox = createSandboxHandle("sbx_files");
    sandbox.mocks.fileWriteBytes.mockResolvedValueOnce(fileStat());
    sandbox.mocks.fileReadBytes.mockResolvedValueOnce(new Uint8Array([104, 105]));
    sandbox.mocks.fileDownloadUrl.mockResolvedValueOnce({
      authMode: "api_key",
      method: "GET",
      url: "https://api.test/download",
    });
    const { tools } = createHarness([sandbox]);

    const written = await callTool(tools, "write_file_bytes", {
      content_base64: "aGk=",
      create_parents: true,
      overwrite: true,
      path: "/workspace/a.bin",
    });
    const read = await callTool(tools, "read_file_bytes", {
      path: "/workspace/a.bin",
    });
    const url = await callTool(tools, "get_file_download_url", {
      path: "/workspace/a.bin",
    });

    expect(sandbox.mocks.fileWriteBytes).toHaveBeenCalledWith(
      "/workspace/a.bin",
      Buffer.from("aGk=", "base64"),
      { createParents: true, overwrite: true },
    );
    expect(sandbox.mocks.fileReadBytes).toHaveBeenCalledWith("/workspace/a.bin");
    expect(sandbox.mocks.fileDownloadUrl).toHaveBeenCalledWith("/workspace/a.bin");
    expect(text(written)).toContain('"sandbox_id": "sbx_files"');
    expect(text(read)).toContain('"content_base64": "aGk="');
    expect(text(url)).toContain('"url": "https://api.test/download"');
  });
});

describe("Command inspection tools", () => {
  it("inspects, cancels, and reads bounded Command logs", async () => {
    const sandbox = createSandboxHandle("sbx_default");
    const { client, tools } = createHarness([sandbox]);
    client.mocks.getCommand.mockResolvedValueOnce(commandResult("sbx_default"));
    client.mocks.cancelCommand.mockResolvedValueOnce({
      ...commandResult("sbx_default"),
      status: "exited",
    });
    client.mocks.readCommandLogs.mockResolvedValueOnce({
      data: [commandLog("stdout", "one\ntwo\n"), commandLog("stderr", "three\n")],
      hasMore: false,
    });

    const command = await callTool(tools, "get_command", {
      command_id: "cmd_123",
    });
    const canceled = await callTool(tools, "cancel_command", {
      command_id: "cmd_123",
      mode: "force",
    });
    const logs = await callTool(tools, "stream_command_logs", {
      command_id: "cmd_123",
      max_lines: 2,
    });

    expect(client.mocks.getCommand).toHaveBeenCalledWith("cmd_123");
    expect(client.mocks.cancelCommand).toHaveBeenCalledWith("cmd_123", {
      mode: "force",
    });
    expect(client.mocks.readCommandLogs).toHaveBeenCalledWith("cmd_123", {
      limit: 3,
    });
    expect(text(command)).toContain('"command_id": "cmd_123"');
    expect(text(canceled)).toContain('"status": "exited"');
    expect(text(logs)).toContain("truncated: true");
    expect(text(logs)).toContain("stdout: one");
    expect(text(logs)).toContain("[truncated after 2 lines]");
  });

  it("uses an API-safe default Command log replay limit", async () => {
    const { client, tools } = createHarness([createSandboxHandle("sbx_default")]);
    client.mocks.readCommandLogs.mockResolvedValueOnce({
      data: [],
      hasMore: false,
    });

    const logs = await callTool(tools, "stream_command_logs", {
      command_id: "cmd_123",
    });

    expect(client.mocks.readCommandLogs).toHaveBeenCalledWith("cmd_123", {
      limit: 100,
    });
    expect(text(logs)).toContain("max_lines: 99");
  });
});

describe("Workspace mutation tools", () => {
  it("deletes, moves, creates, and stats Workspace files", async () => {
    const sandbox = createSandboxHandle("sbx_files");
    sandbox.mocks.fileMove.mockResolvedValueOnce(fileStat("/workspace/b.txt"));
    sandbox.mocks.fileMkdir.mockResolvedValueOnce(directoryStat());
    sandbox.mocks.fileStat.mockResolvedValueOnce(fileStat("/workspace/b.txt"));
    const { tools } = createHarness([sandbox]);

    const deleted = await callTool(tools, "delete_file", {
      path: "/workspace/a.txt",
    });
    const moved = await callTool(tools, "move_file", {
      from: "/workspace/a.txt",
      overwrite: true,
      to: "/workspace/b.txt",
    });
    const directory = await callTool(tools, "make_directory", {
      parents: true,
      path: "/workspace/out",
    });
    const stat = await callTool(tools, "stat_file", {
      path: "/workspace/b.txt",
    });

    expect(sandbox.mocks.fileDelete).toHaveBeenCalledWith("/workspace/a.txt");
    expect(sandbox.mocks.fileMove).toHaveBeenCalledWith(
      "/workspace/a.txt",
      "/workspace/b.txt",
      { overwrite: true },
    );
    expect(sandbox.mocks.fileMkdir).toHaveBeenCalledWith("/workspace/out", {
      parents: true,
    });
    expect(sandbox.mocks.fileStat).toHaveBeenCalledWith("/workspace/b.txt");
    expect(text(deleted)).toContain('"deleted": true');
    expect(text(moved)).toContain('"path": "/workspace/b.txt"');
    expect(text(directory)).toContain('"type": "directory"');
    expect(text(stat)).toContain('"size_bytes": 5');
  });
});

describe("explicit Sandbox routing", () => {
  it("routes stateful tools to an explicit non-default Sandbox id", async () => {
    const defaultSandbox = createSandboxHandle("sbx_default");
    const explicitSandbox = createSandboxHandle("sbx_explicit");
    explicitSandbox.mocks.commandRun.mockResolvedValueOnce(
      commandResult("sbx_explicit"),
    );
    explicitSandbox.mocks.fileRead.mockResolvedValueOnce("hello");
    const { tools } = createHarness([defaultSandbox, explicitSandbox]);

    await callTool(tools, "create_sandbox", {});
    await callTool(tools, "create_sandbox", {});
    const command = await callTool(tools, "run_command", explicitCommandInput());
    const file = await callTool(tools, "read_file", explicitReadInput());

    expect(defaultSandbox.mocks.commandRun).not.toHaveBeenCalled();
    expect(defaultSandbox.mocks.fileRead).not.toHaveBeenCalled();
    expect(explicitSandbox.mocks.commandRun).toHaveBeenCalledWith("pwd", {});
    expect(explicitSandbox.mocks.fileRead).toHaveBeenCalledWith("/workspace/a.txt", {
      encoding: "utf8",
    });
    expect(text(command)).toContain("sandbox_id: sbx_explicit");
    expect(text(file)).toContain('"sandbox_id": "sbx_explicit"');
  });
});

function commandResult(sandboxId: `sbx_${string}`) {
  return {
    command: "pwd",
    cwd: "/workspace",
    env: {},
    exitCode: 0,
    id: "cmd_123",
    sandboxId,
    status: "exited",
  };
}

function commandLog(stream: "stderr" | "stdout", data: string) {
  return {
    commandId: "cmd_123",
    createdAt: "2026-06-12T12:00:00.000Z",
    data,
    seq: stream === "stdout" ? 1 : 2,
    stream,
  };
}

function fileInput() {
  return {
    content: "hello",
    path: "/workspace/a.txt",
  };
}

function explicitCommandInput() {
  return {
    command: "pwd",
    sandbox_id: "sbx_explicit",
  };
}

function explicitReadInput() {
  return {
    path: "/workspace/a.txt",
    sandbox_id: "sbx_explicit",
  };
}

function fileStat(path = "/workspace/a.txt") {
  return {
    modifiedAt: "2026-06-12T12:00:00.000Z",
    path,
    sizeBytes: 5,
    type: "file",
  };
}

function directoryStat() {
  return {
    modifiedAt: "2026-06-12T12:00:00.000Z",
    path: "/workspace/out",
    sizeBytes: 0,
    type: "directory",
  };
}

function fileEntry() {
  return {
    name: "a.txt",
    path: "/workspace/a.txt",
    sizeBytes: 5,
    type: "file",
  };
}
