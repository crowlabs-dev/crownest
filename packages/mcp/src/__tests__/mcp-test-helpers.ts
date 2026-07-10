import type { CrowNestClient, SandboxHandle } from "@crownest/sdk";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Mock } from "vitest";
import { vi } from "vitest";

import { McpSession } from "../session";
import { registerCrowNestTools } from "../tools";

export type RegisteredTool = {
  readonly config: { readonly description?: string; readonly inputSchema?: unknown };
  readonly handler: (input: never) => Promise<CallToolResult>;
  readonly name: string;
};

export type TestClient = CrowNestClient & {
  readonly mocks: {
    readonly cancelCommand: Mock;
    readonly createSandbox: Mock;
    readonly createProject: Mock;
    readonly createWorkspaceRun: Mock;
    readonly createWorkspaceRunArchiveTransfer: Mock;
    readonly deleteArtifact: Mock;
    readonly downloadArtifact: Mock;
    readonly downloadArtifactUrl: Mock;
    readonly setSandboxTtl: Mock;
    readonly finalizeWorkspaceRunArchive: Mock;
    readonly getApiKey: Mock;
    readonly getArtifact: Mock;
    readonly getCommand: Mock;
    readonly getPreview: Mock;
    readonly getSandbox: Mock;
    readonly getWorkspaceRun: Mock;
    readonly getWorkspaceRunEvidence: Mock;
    readonly listApiKeys: Mock;
    readonly listProjects: Mock;
    readonly listSandboxes: Mock;
    readonly listWorkspaceRunEvents: Mock;
    readonly listWorkspaceRuns: Mock;
    readonly readCommandLogs: Mock;
    readonly revokeApiKey: Mock;
    readonly revokePreview: Mock;
    readonly startWorkspaceRun: Mock;
    readonly cancelWorkspaceRun: Mock;
    readonly uploadWorkspaceRunArchive: Mock;
    readonly uploadWorkspaceRunArchiveToTransfer: Mock;
    readonly usage: Mock;
  };
};
type ClientMocks = TestClient["mocks"];

export type TestSandbox = SandboxHandle & {
  readonly mocks: {
    readonly artifactCreate: Mock;
    readonly artifactList: Mock;
    readonly codeCreateContext: Mock;
    readonly codeDeleteContext: Mock;
    readonly codeGetContext: Mock;
    readonly codeListContexts: Mock;
    readonly codeRun: Mock;
    readonly commandCancel: Mock;
    readonly commandRun: Mock;
    readonly fileDelete: Mock;
    readonly fileDownloadUrl: Mock;
    readonly fileList: Mock;
    readonly fileMkdir: Mock;
    readonly fileMove: Mock;
    readonly fileRead: Mock;
    readonly fileReadBytes: Mock;
    readonly fileStat: Mock;
    readonly fileWrite: Mock;
    readonly fileWriteBytes: Mock;
    readonly kill: Mock;
    readonly previewCreate: Mock;
    readonly previewList: Mock;
    readonly sandboxSetTtl: Mock;
  };
};

export function createHarness(sandboxes: readonly SandboxHandle[] = []) {
  const tools = new Map<string, RegisteredTool>();
  const calls: RegisteredTool[] = [];
  const server = createServer(tools, calls);
  const client = createClient(sandboxes);
  const session = new McpSession({ apiKey: "cn_test", client });

  registerCrowNestTools(server, session);

  return { calls, client, tools };
}

export async function callTool(
  tools: ReadonlyMap<string, RegisteredTool>,
  name: string,
  input: unknown,
): Promise<CallToolResult> {
  const tool = tools.get(name);
  if (tool === undefined) {
    throw new Error(`Missing tool ${name}`);
  }

  return tool.handler(input as never);
}

export function text(result: CallToolResult): string {
  const first = result.content[0];
  return first?.type === "text" ? first.text : "";
}

export function createSandboxHandle(
  id: `sbx_${string}`,
  input: {
    readonly expiresAt?: string;
    readonly status?: SandboxHandle["status"];
  } = {},
): TestSandbox {
  const mocks = sandboxMocks();
  return {
    artifacts: {
      create: mocks.artifactCreate,
      list: mocks.artifactList,
    },
    code: {
      createContext: mocks.codeCreateContext,
      deleteContext: mocks.codeDeleteContext,
      getContext: mocks.codeGetContext,
      listContexts: mocks.codeListContexts,
      run: mocks.codeRun,
    },
    commands: {
      cancel: mocks.commandCancel,
      run: mocks.commandRun,
    },
    createdAt: "2026-06-12T12:00:00.000Z",
    expiresAt: input.expiresAt ?? "2999-01-01T00:00:00.000Z",
    files: {
      delete: mocks.fileDelete,
      downloadUrl: mocks.fileDownloadUrl,
      list: mocks.fileList,
      mkdir: mocks.fileMkdir,
      move: mocks.fileMove,
      read: mocks.fileRead,
      readBytes: mocks.fileReadBytes,
      stat: mocks.fileStat,
      write: mocks.fileWrite,
      writeBytes: mocks.fileWriteBytes,
    },
    id,
    kill: mocks.kill,
    mocks,
    previews: {
      create: mocks.previewCreate,
      list: mocks.previewList,
    },
    projectId: "prj_test",
    status: input.status ?? "ready",
    templateSlug: "python-node",
    templateVersion: "1.0.0",
    ttlMs: 60_000,
    setTtl: mocks.sandboxSetTtl,
  } as unknown as TestSandbox;
}

function createServer(
  tools: Map<string, RegisteredTool>,
  calls: RegisteredTool[],
): McpServer {
  return {
    registerTool(
      name: string,
      config: RegisteredTool["config"],
      handler: RegisteredTool["handler"],
    ) {
      const call = { config, handler, name };
      calls.push(call);
      tools.set(name, call);
    },
  } as unknown as McpServer;
}

function createClient(sandboxes: readonly SandboxHandle[]): TestClient {
  const mocks = clientMocks();
  for (const sandbox of sandboxes) {
    mocks.createSandbox.mockResolvedValueOnce(sandbox);
  }

  return {
    apiKeys: {
      get: mocks.getApiKey,
      list: mocks.listApiKeys,
      revoke: mocks.revokeApiKey,
    },
    artifacts: {
      delete: mocks.deleteArtifact,
      download: mocks.downloadArtifact,
      downloadUrl: mocks.downloadArtifactUrl,
      get: mocks.getArtifact,
    },
    code: {},
    commands: {
      cancel: mocks.cancelCommand,
      get: mocks.getCommand,
      logs: mocks.readCommandLogs,
    },
    files: {},
    mocks,
    previews: { get: mocks.getPreview, revoke: mocks.revokePreview },
    projects: { create: mocks.createProject, list: mocks.listProjects },
    sandboxes: {
      create: mocks.createSandbox,
      get: mocks.getSandbox,
      list: mocks.listSandboxes,
      setTtl: mocks.setSandboxTtl,
    },
    usage: mocks.usage,
    workspaceRuns: {
      cancel: mocks.cancelWorkspaceRun,
      create: mocks.createWorkspaceRun,
      createArchiveTransfer: mocks.createWorkspaceRunArchiveTransfer,
      evidence: mocks.getWorkspaceRunEvidence,
      finalizeArchive: mocks.finalizeWorkspaceRunArchive,
      get: mocks.getWorkspaceRun,
      list: mocks.listWorkspaceRuns,
      listEvents: mocks.listWorkspaceRunEvents,
      start: mocks.startWorkspaceRun,
      uploadArchive: mocks.uploadWorkspaceRunArchive,
      uploadArchiveToTransfer: mocks.uploadWorkspaceRunArchiveToTransfer,
    },
  } as unknown as TestClient;
}

function clientMocks(): ClientMocks {
  return {
    cancelCommand: vi.fn(),
    cancelWorkspaceRun: vi.fn(),
    createProject: vi.fn(),
    createSandbox: vi.fn(),
    createWorkspaceRun: vi.fn(),
    createWorkspaceRunArchiveTransfer: vi.fn(),
    deleteArtifact: vi.fn(),
    downloadArtifact: vi.fn(),
    downloadArtifactUrl: vi.fn(),
    finalizeWorkspaceRunArchive: vi.fn(),
    getApiKey: vi.fn(),
    getArtifact: vi.fn(),
    getCommand: vi.fn(),
    getPreview: vi.fn(),
    getSandbox: vi.fn(),
    getWorkspaceRun: vi.fn(),
    getWorkspaceRunEvidence: vi.fn(),
    listApiKeys: vi.fn(),
    listProjects: vi.fn(),
    listSandboxes: vi.fn(),
    listWorkspaceRunEvents: vi.fn(),
    listWorkspaceRuns: vi.fn(),
    readCommandLogs: vi.fn(),
    revokeApiKey: vi.fn(),
    revokePreview: vi.fn(),
    setSandboxTtl: vi.fn(),
    startWorkspaceRun: vi.fn(),
    uploadWorkspaceRunArchive: vi.fn(),
    uploadWorkspaceRunArchiveToTransfer: vi.fn(),
    usage: vi.fn(),
  };
}

function sandboxMocks(): TestSandbox["mocks"] {
  return {
    artifactCreate: vi.fn(),
    artifactList: vi.fn(),
    codeCreateContext: vi.fn(),
    codeDeleteContext: vi.fn(),
    codeGetContext: vi.fn(),
    codeListContexts: vi.fn(),
    codeRun: vi.fn(),
    commandCancel: vi.fn(),
    commandRun: vi.fn(),
    fileDelete: vi.fn().mockResolvedValue(undefined),
    fileDownloadUrl: vi.fn(),
    fileList: vi.fn(),
    fileMkdir: vi.fn(),
    fileMove: vi.fn(),
    fileRead: vi.fn(),
    fileReadBytes: vi.fn(),
    fileStat: vi.fn(),
    fileWrite: vi.fn(),
    fileWriteBytes: vi.fn(),
    kill: vi.fn().mockResolvedValue(undefined),
    previewCreate: vi.fn(),
    previewList: vi.fn(),
    sandboxSetTtl: vi.fn(),
  };
}
