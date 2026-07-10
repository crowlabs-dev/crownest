import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { McpSession } from "./session";
import {
  registerCreateProject,
  registerGetApiKey,
  registerListApiKeys,
  registerListProjects,
  registerRevokeApiKey,
} from "./tools/admin";
import {
  registerCreateArtifact,
  registerDeleteArtifact,
  registerDownloadArtifact,
  registerGetArtifact,
  registerGetArtifactDownloadUrl,
  registerListArtifacts,
} from "./tools/artifacts";
import {
  registerCreateCodeContext,
  registerDeleteCodeContext,
  registerGetCodeContext,
  registerListCodeContexts,
  registerRunCode,
} from "./tools/code";
import {
  registerCancelCommand,
  registerGetCommand,
  registerRunCommand,
  registerStreamCommandLogs,
} from "./tools/commands";
import { registerGetAgentContext } from "./tools/context";
import {
  registerDeleteFile,
  registerGetFileDownloadUrl,
  registerListFiles,
  registerMakeDirectory,
  registerMoveFile,
  registerReadFile,
  registerReadFileBytes,
  registerStatFile,
  registerWriteFile,
  registerWriteFileBytes,
} from "./tools/files";
import {
  registerCreatePreview,
  registerGetPreview,
  registerListPreviews,
  registerRevokePreview,
} from "./tools/previews";
import {
  registerCreateSandbox,
  registerGetSandbox,
  registerKillSandbox,
  registerListSandboxes,
  registerSetSandboxTtl,
} from "./tools/sandboxes";
import type { ToolRegistrar } from "./tools/shared";
import { registerGetUsage } from "./tools/usage";
import {
  registerCancelWorkspaceRun,
  registerCreateWorkspaceRun,
  registerCreateWorkspaceRunArchiveTransfer,
  registerFinalizeWorkspaceRunArchive,
  registerGetWorkspaceRun,
  registerGetWorkspaceRunEvidence,
  registerListWorkspaceRuns,
  registerReplayWorkspaceRunEvents,
  registerStartWorkspaceRun,
  registerUploadWorkspaceRunArchive,
  registerUploadWorkspaceRunArchiveTransfer,
} from "./tools/workspace-runs";

const toolRegistrars = [
  registerRunCode,
  registerGetAgentContext,
  registerRunCommand,
  registerCreateSandbox,
  registerKillSandbox,
  registerWriteFile,
  registerWriteFileBytes,
  registerReadFile,
  registerReadFileBytes,
  registerGetFileDownloadUrl,
  registerListFiles,
  registerDownloadArtifact,
  registerGetArtifactDownloadUrl,
  registerListSandboxes,
  registerGetUsage,
  registerGetSandbox,
  registerSetSandboxTtl,
  registerGetCommand,
  registerCancelCommand,
  registerStreamCommandLogs,
  registerDeleteFile,
  registerMoveFile,
  registerMakeDirectory,
  registerStatFile,
  registerCreateArtifact,
  registerListArtifacts,
  registerGetArtifact,
  registerDeleteArtifact,
  registerCreatePreview,
  registerListPreviews,
  registerGetPreview,
  registerRevokePreview,
  registerCreateCodeContext,
  registerListCodeContexts,
  registerGetCodeContext,
  registerDeleteCodeContext,
  registerListApiKeys,
  registerGetApiKey,
  registerRevokeApiKey,
  registerCreateProject,
  registerListProjects,
  registerCreateWorkspaceRun,
  registerUploadWorkspaceRunArchive,
  registerCreateWorkspaceRunArchiveTransfer,
  registerUploadWorkspaceRunArchiveTransfer,
  registerFinalizeWorkspaceRunArchive,
  registerStartWorkspaceRun,
  registerGetWorkspaceRun,
  registerListWorkspaceRuns,
  registerReplayWorkspaceRunEvents,
  registerCancelWorkspaceRun,
  registerGetWorkspaceRunEvidence,
] satisfies readonly ToolRegistrar[];

export function registerCrowNestTools(server: McpServer, session: McpSession): void {
  for (const registerTool of toolRegistrars) {
    registerTool(server, session);
  }
}
