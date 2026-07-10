import type {
  ApiKeyScope,
  ArtifactDownloadUrlResponse,
  CreateProjectResponse,
  CreateSandboxResponse,
  DeleteArtifactResponse,
  DeletePreviewResponse,
  ErrorCode,
  GetApiKeyResponse,
  GetArtifactResponse,
  GetCommandResponse,
  GetPreviewResponse,
  GetSandboxResponse,
  KillSandboxResponse,
  ListApiKeysResponse,
  ListCommandLogsResponse,
  ListProjectsResponse,
  ListSandboxesResponse,
  RevokeApiKeyResponse,
  SetSandboxTtlResponse,
  UsageSummaryResponse,
} from "@crownest/contracts";
import { ApiKeyScopes } from "@crownest/contracts";

import type {
  CreateSandboxInput,
  CrowNestClient,
  ListInput,
  ListSandboxesInput,
} from "./client-types";
import { runCommandWithCallbacks, streamCommandLogs } from "./command-stream";
import { createPage, paginationParams } from "./pagination";
import { pollUntil } from "./polling";
import {
  cancelCommand,
  commandLogParams,
  createTransport,
  type CrowNestClientOptions,
  queryString,
  type Transport,
} from "./protocol";
import { createSandboxFilesClient } from "./sandbox-files-client";
import {
  createSandboxArtifactsClient,
  createSandboxCodeClient,
  createSandboxHandle,
  createSandboxPreviewsClient,
} from "./sandbox-handle";
import { createWorkspaceRunsClient } from "./workspace-runs";

export type {
  CodeArtifactPolicy,
  CodeLanguage,
  CommandStreamInput,
  CreateProjectInput,
  CreateSandboxInput,
  CreateWorkspaceRunArchiveTransferInput,
  CreateWorkspaceRunInput,
  CrowNestClient,
  FinalizeWorkspaceRunArchiveInput,
  ListInput,
  ListSandboxesInput,
  ListSandboxHandlesResponse,
  ListWorkspaceRunsInput,
  RunWorkspaceRunArchiveInput,
  RunWorkspaceRunInput,
  SetSandboxTtlInput,
  StartWorkspaceRunInput,
  UploadWorkspaceRunArchiveInput,
  UploadWorkspaceRunArchiveTransferInput,
  WaitForCommandInput,
  WaitForTerminalInput,
  WaitUntilDoneInput,
  WaitUntilReadyInput,
  WorkspaceRunEventsInput,
  WorkspaceRunsClient,
} from "./client-types";
export type { AutoPage } from "./pagination";
export type {
  CrowNestClientOptions,
  CrowNestErrorCode,
  RequestOptions,
  RunCommandOptions,
  StreamRequestOptions,
} from "./protocol";
export { CrowNestApiError } from "./protocol";
export type { SandboxHandle } from "./sandbox-handle";
export { ApiKeyScopes };
export type { ApiKeyScope, ErrorCode };

/**
 * Create a CrowNest TypeScript client for Sandbox, Command, Code Run,
 * Workspace file, Artifact, Preview, Project, API Key, and usage APIs.
 * @param options - Optional bearer credential, base URL, fetch implementation, and timeout settings.
 * @returns A typed CrowNestClient with grouped resource helpers.
 */
export function createCrowNestClient(
  options: CrowNestClientOptions = {},
): CrowNestClient {
  const transport = createTransport(options);

  return {
    apiKeys: createApiKeyClient(transport),
    artifacts: createArtifactClient(transport),
    code: createCodeClient(transport),
    commands: createCommandClient(transport),
    files: createFileClient(transport),
    previews: createPreviewClient(transport),
    projects: createProjectClient(transport),
    sandboxes: createSandboxClient(transport),
    workspaceRuns: createWorkspaceRunsClient(transport),
    usage() {
      return transport.request<UsageSummaryResponse>("/v1/usage", {
        method: "GET",
      });
    },
  };
}

function createCodeClient(transport: Transport): CrowNestClient["code"] {
  return {
    createContext(sandboxId, input) {
      return createSandboxCodeClient(sandboxId, transport).createContext(input);
    },
    deleteContext(sandboxId, contextId) {
      return createSandboxCodeClient(sandboxId, transport).deleteContext(contextId);
    },
    getContext(sandboxId, contextId) {
      return createSandboxCodeClient(sandboxId, transport).getContext(contextId);
    },
    listContexts(sandboxId, input) {
      return createSandboxCodeClient(sandboxId, transport).listContexts(input);
    },
    run(sandboxId, input) {
      return createSandboxCodeClient(sandboxId, transport).run(input);
    },
    runStream(sandboxId, input) {
      return createSandboxCodeClient(sandboxId, transport).runStream(input);
    },
  };
}

function createApiKeyClient(transport: Transport): CrowNestClient["apiKeys"] {
  return {
    async get(apiKeyId) {
      const response = await transport.request<GetApiKeyResponse>(
        `/v1/api-keys/${apiKeyId}`,
        { method: "GET" },
      );
      return response.apiKey;
    },
    async list(input: ListInput = {}) {
      const fetchPage = (cursor = input.cursor) =>
        transport.request<ListApiKeysResponse>(
          `/v1/api-keys${queryString(paginationParams({ ...input, cursor }))}`,
          { method: "GET", signal: input.signal },
        );
      return createPage(await fetchPage(), fetchPage);
    },
    async revoke(apiKeyId) {
      const response = await transport.request<RevokeApiKeyResponse>(
        `/v1/api-keys/${apiKeyId}`,
        { method: "DELETE" },
      );
      return response.apiKey;
    },
  };
}

function createArtifactClient(transport: Transport): CrowNestClient["artifacts"] {
  return {
    create(sandboxId, input) {
      return createSandboxArtifactsClient(sandboxId, transport).create(input);
    },
    async delete(artifactId) {
      const response = await transport.request<DeleteArtifactResponse>(
        `/v1/artifacts/${artifactId}`,
        { method: "DELETE" },
      );
      return response.artifact;
    },
    async download(artifactId) {
      return transport.download(`/v1/artifacts/${artifactId}/download`);
    },
    downloadUrl(artifactId) {
      return transport.request<ArtifactDownloadUrlResponse>(
        `/v1/artifacts/${artifactId}/download-url`,
        { method: "POST" },
      );
    },
    async get(artifactId) {
      const response = await transport.request<GetArtifactResponse>(
        `/v1/artifacts/${artifactId}`,
        { method: "GET" },
      );
      return response.artifact;
    },
    list(sandboxId, input) {
      return createSandboxArtifactsClient(sandboxId, transport).list(input);
    },
  };
}

function createFileClient(transport: Transport): CrowNestClient["files"] {
  return {
    delete(sandboxId, path) {
      return createSandboxFilesClient(sandboxId, transport).delete(path);
    },
    downloadUrl(sandboxId, path) {
      return createSandboxFilesClient(sandboxId, transport).downloadUrl(path);
    },
    list(sandboxId, path) {
      return createSandboxFilesClient(sandboxId, transport).list(path);
    },
    mkdir(sandboxId, path, input) {
      return createSandboxFilesClient(sandboxId, transport).mkdir(path, input);
    },
    move(sandboxId, from, to, input) {
      return createSandboxFilesClient(sandboxId, transport).move(from, to, input);
    },
    read(sandboxId, path, input) {
      return createSandboxFilesClient(sandboxId, transport).read(path, input);
    },
    readBytes(sandboxId, path) {
      return createSandboxFilesClient(sandboxId, transport).readBytes(path);
    },
    stat(sandboxId, path) {
      return createSandboxFilesClient(sandboxId, transport).stat(path);
    },
    write(sandboxId, path, content, input) {
      return createSandboxFilesClient(sandboxId, transport).write(path, content, input);
    },
    writeBytes(sandboxId, path, bytes, input) {
      return createSandboxFilesClient(sandboxId, transport).writeBytes(
        path,
        bytes,
        input,
      );
    },
  };
}

function createPreviewClient(transport: Transport): CrowNestClient["previews"] {
  return {
    create(sandboxId, input) {
      return createSandboxPreviewsClient(sandboxId, transport).create(input);
    },
    async get(previewId) {
      const response = await transport.request<GetPreviewResponse>(
        `/v1/previews/${previewId}`,
        { method: "GET" },
      );
      return response.preview;
    },
    list(sandboxId, input) {
      return createSandboxPreviewsClient(sandboxId, transport).list(input);
    },
    async revoke(previewId) {
      const response = await transport.request<DeletePreviewResponse>(
        `/v1/previews/${previewId}`,
        { method: "DELETE" },
      );
      return response.preview;
    },
  };
}

function createProjectClient(transport: Transport): CrowNestClient["projects"] {
  return {
    async create(input) {
      const response = await transport.request<CreateProjectResponse>("/v1/projects", {
        body: input,
        method: "POST",
      });
      return response.project;
    },
    async list(input: ListInput = {}) {
      const fetchPage = (cursor = input.cursor) =>
        transport.request<ListProjectsResponse>(
          `/v1/projects${queryString(paginationParams({ ...input, cursor }))}`,
          { method: "GET", signal: input.signal },
        );
      return createPage(await fetchPage(), fetchPage);
    },
  };
}

function createCommandClient(transport: Transport): CrowNestClient["commands"] {
  return {
    cancel: (commandId, input = {}) => cancelCommand(transport, commandId, input),
    async get(commandId) {
      const response = await transport.request<GetCommandResponse>(
        `/v1/commands/${commandId}`,
        { method: "GET" },
      );

      return response.command;
    },
    async logs(commandId, input = {}) {
      const response = await transport.request<ListCommandLogsResponse>(
        `/v1/commands/${commandId}/logs${queryString(commandLogParams(input))}`,
        { method: "GET" },
      );

      return response;
    },
    run(sandboxId, command, input = {}) {
      return runCommandWithCallbacks(transport, sandboxId, command, input);
    },
    streamLogs(commandId, input = {}) {
      return streamCommandLogs(transport, commandId, input);
    },
    wait(commandId, input = {}) {
      return pollUntil({
        fetch: async () => {
          const response = await transport.request<GetCommandResponse>(
            `/v1/commands/${commandId}`,
            { method: "GET", signal: input.signal },
          );
          return response.command;
        },
        isTerminal: (command) =>
          ["exited", "failed", "canceled", "timed_out", "killed"].includes(
            command.status,
          ),
        options: input,
        timeoutMessage: `Timed out waiting for Command ${commandId} to finish.`,
      });
    },
  };
}

function createSandboxClient(transport: Transport): CrowNestClient["sandboxes"] {
  return {
    async create(input: CreateSandboxInput = {}) {
      const { idempotencyKey, ...body } = input;
      const response = await transport.request<CreateSandboxResponse>("/v1/sandboxes", {
        body,
        ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
        idempotent: true,
        method: "POST",
      });

      return createSandboxHandle(response.sandbox, transport);
    },
    async setTtl(sandboxId, input) {
      const { idempotencyKey, ...body } = input;
      const response = await transport.request<SetSandboxTtlResponse>(
        `/v1/sandboxes/${sandboxId}/ttl`,
        {
          body,
          ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
          idempotent: true,
          method: "POST",
        },
      );

      return createSandboxHandle(response.sandbox, transport);
    },
    async get(sandboxId) {
      const response = await transport.request<GetSandboxResponse>(
        `/v1/sandboxes/${sandboxId}`,
        { method: "GET" },
      );

      return createSandboxHandle(response.sandbox, transport);
    },
    async kill(sandboxId) {
      const response = await transport.request<KillSandboxResponse>(
        `/v1/sandboxes/${sandboxId}`,
        { method: "DELETE" },
      );
      return createSandboxHandle(response.sandbox, transport);
    },
    async list(input = {}) {
      const fetchPage = async (cursor = input.cursor) => {
        const response = await transport.request<ListSandboxesResponse>(
          `/v1/sandboxes${queryString(sandboxListParams({ ...input, cursor }))}`,
          { method: "GET", signal: input.signal },
        );
        return {
          ...response,
          data: response.data.map((sandbox) => createSandboxHandle(sandbox, transport)),
        };
      };
      return createPage(await fetchPage(), fetchPage);
    },
  };
}

function sandboxListParams(input: ListSandboxesInput): URLSearchParams {
  const params = paginationParams(input);
  for (const [key, value] of Object.entries(input.metadata ?? {})) {
    params.set(`metadata.${key}`, value);
  }
  return params;
}
