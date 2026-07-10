import type {
  Artifact,
  ArtifactDownloadUrlResponse,
  CodeArtifactPolicy,
  CodeContextRef,
  CodeLanguage,
  CodeRunEvent,
  Command,
  CommandLogStreamEvent,
  CreateArtifactResponse,
  CreateCodeContextResponse,
  CreatePreviewResponse,
  DeleteArtifactResponse,
  DeleteCodeContextResponse,
  DeletePreviewResponse,
  FileDownloadUrlResponse,
  FileEncoding,
  FileStat,
  GetArtifactResponse,
  GetCodeContextResponse,
  GetPreviewResponse,
  KillSandboxResponse,
  ListArtifactsResponse,
  ListCodeContextsResponse,
  ListCommandLogsResponse,
  ListFilesResponse,
  ListPreviewsResponse,
  Preview,
  PreviewAuthMode,
  RunCodeResponse,
  RunCodeResult,
  Sandbox,
  SetSandboxTtlResponse,
} from "@crownest/contracts";

import type {
  CommandStreamInput,
  ListInput,
  WaitForCommandInput,
  WaitUntilReadyInput,
} from "./client-types";
import type { AutoPage } from "./pagination";
import { createPage, paginationParams } from "./pagination";
import { queryString, type RunCommandOptions, type Transport } from "./protocol";
import { createSandboxCommands } from "./sandbox-commands-client";
import { createSandboxFilesClient } from "./sandbox-files-client";
import { waitUntilSandboxReady } from "./sandbox-wait";

export type SandboxHandle = Sandbox & {
  readonly artifacts: {
    /** Export a Workspace file in this Sandbox as a durable Artifact. */
    create(input: {
      readonly idempotencyKey?: string;
      readonly name?: string;
      readonly path: string;
    }): Promise<Artifact>;
    /** Delete an Artifact exported from this Sandbox. */
    delete(artifactId: `art_${string}`): Promise<Artifact>;
    /** Download Artifact bytes. */
    download(artifactId: `art_${string}`): Promise<Uint8Array>;
    /** Create or reuse a short-lived Artifact download URL. */
    downloadUrl(artifactId: `art_${string}`): Promise<ArtifactDownloadUrlResponse>;
    /** Retrieve Artifact metadata. */
    get(artifactId: `art_${string}`): Promise<Artifact>;
    /** List Artifacts exported from this Sandbox. */
    list(input?: ListInput): Promise<AutoPage<Artifact>>;
  };
  readonly code: {
    /** Create a Code Context in this Sandbox. */
    createContext(input?: CreateCodeContextInput): Promise<CodeContextRef>;
    /** Delete a Code Context in this Sandbox. */
    deleteContext(contextId: `cctx_${string}`): Promise<CodeContextRef>;
    /** Retrieve Code Context metadata in this Sandbox. */
    getContext(contextId: `cctx_${string}`): Promise<CodeContextRef>;
    /** List Code Contexts in this Sandbox. */
    listContexts(input?: ListInput): Promise<AutoPage<CodeContextRef>>;
    /** Run interpreter code in this Sandbox. */
    run(input: RunCodeInput): Promise<RunCodeResult>;
    /** Stream interpreter code execution events from this Sandbox. */
    runStream(input: RunCodeInput): AsyncIterable<CodeRunEvent>;
  };
  readonly commands: {
    /** Cancel a Command in this Sandbox. */
    cancel(
      commandId: `cmd_${string}`,
      input?: { readonly mode?: "force" | "graceful" },
    ): Promise<Command>;
    /** Retrieve Command metadata. */
    get(commandId: `cmd_${string}`): Promise<Command>;
    /** Read bounded Command log chunks. */
    logs(
      commandId: `cmd_${string}`,
      input?: { readonly afterSeq?: number; readonly limit?: number },
    ): Promise<ListCommandLogsResponse>;
    /** Run a Command, waiting unless `background` is true. */
    run(command: string, input?: RunCommandOptions): Promise<Command>;
    /** Stream Command log events with optional reconnect support. */
    streamLogs(
      commandId: `cmd_${string}`,
      input?: CommandStreamInput,
    ): AsyncIterable<CommandLogStreamEvent>;
    /** Poll until this Command reaches a terminal status. */
    wait(commandId: `cmd_${string}`, input?: WaitForCommandInput): Promise<Command>;
  };
  readonly files: {
    /** Delete a Workspace file or empty directory in this Sandbox. */
    delete(path: string): Promise<void>;
    /** Create or reuse a short-lived download URL for a Workspace file. */
    downloadUrl(path: string): Promise<FileDownloadUrlResponse>;
    /** List entries in a Workspace directory. */
    list(path?: string): Promise<ListFilesResponse>;
    /** Create a Workspace directory in this Sandbox. */
    mkdir(path: string, input?: { readonly parents?: boolean }): Promise<FileStat>;
    /** Move or rename a Workspace file or directory. */
    move(
      from: string,
      to: string,
      input?: { readonly overwrite?: boolean },
    ): Promise<FileStat>;
    /** Read a small Workspace file as text. */
    read(path: string, input?: { readonly encoding?: FileEncoding }): Promise<string>;
    /**
     * Reads a small file as bytes through the direct base64 API. Direct payloads
     * are capped by the API's maxDirectFileReadBytes; use downloadUrl or
     * artifacts for larger files.
     */
    readBytes(path: string): Promise<Uint8Array>;
    /** Inspect Workspace file metadata. */
    stat(path: string): Promise<FileStat>;
    /** Write a small Workspace text file. */
    write(
      path: string,
      content: string,
      input?: {
        readonly createParents?: boolean;
        readonly encoding?: FileEncoding;
        readonly overwrite?: boolean;
      },
    ): Promise<FileStat>;
    /**
     * Writes a small file as bytes through the direct base64 API. Direct payloads
     * are capped by the API's maxDirectFileWriteBytes; use downloadUrl or
     * artifacts for larger files.
     */
    writeBytes(
      path: string,
      bytes: Uint8Array,
      input?: {
        readonly createParents?: boolean;
        readonly overwrite?: boolean;
      },
    ): Promise<FileStat>;
  };
  readonly previews: {
    /** Create a Preview for a port in this Sandbox. */
    create(input: {
      readonly authMode?: PreviewAuthMode;
      readonly port: number;
    }): Promise<CreatePreviewResponse>;
    /** Retrieve Preview metadata. */
    get(previewId: `prv_${string}`): Promise<Preview>;
    /** List Previews for this Sandbox. */
    list(input?: ListInput): Promise<AutoPage<Preview>>;
    /** Revoke a Preview. */
    revoke(previewId: `prv_${string}`): Promise<Preview>;
  };
  /** Set this Sandbox TTL and reset its expiration countdown from now. */
  setTtl(input: {
    readonly idempotencyKey?: string;
    readonly ttlMs: number;
  }): Promise<SandboxHandle>;
  /** Kill this Sandbox. */
  kill(): Promise<SandboxHandle>;
  /** Poll until this Sandbox is ready to accept work. */
  waitUntilReady(input?: WaitUntilReadyInput): Promise<SandboxHandle>;
};

export type CreateCodeContextInput = {
  readonly cwd?: string;
  readonly idempotencyKey?: string;
  readonly language?: CodeLanguage;
  readonly timeoutMs?: number;
};

export type RunCodeInput = {
  readonly artifactPolicy?: CodeArtifactPolicy;
  readonly code: string;
  readonly contextId?: `cctx_${string}`;
  readonly cwd?: string;
  readonly idempotencyKey?: string;
  readonly language?: CodeLanguage;
  readonly timeoutMs?: number;
};

export function createSandboxHandle(
  sandbox: Sandbox,
  transport: Transport,
): SandboxHandle {
  return {
    ...sandbox,
    artifacts: createSandboxArtifactsClient(sandbox.id, transport),
    code: createSandboxCodeClient(sandbox.id, transport),
    commands: createSandboxCommands(sandbox, transport),
    setTtl: async (input) => {
      const { idempotencyKey, ...body } = input;
      const response = await transport.request<SetSandboxTtlResponse>(
        `/v1/sandboxes/${sandbox.id}/ttl`,
        {
          body,
          ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
          idempotent: true,
          method: "POST",
        },
      );

      return createSandboxHandle(response.sandbox, transport);
    },
    files: createSandboxFilesClient(sandbox.id, transport),
    kill: async () => {
      const response = await transport.request<KillSandboxResponse>(
        `/v1/sandboxes/${sandbox.id}`,
        { method: "DELETE" },
      );

      return createSandboxHandle(response.sandbox, transport);
    },
    previews: createSandboxPreviewsClient(sandbox.id, transport),
    waitUntilReady: (input) =>
      waitUntilSandboxReady(sandbox, transport, createSandboxHandle, input),
  };
}

export function createSandboxPreviewsClient(
  sandboxId: `sbx_${string}`,
  transport: Transport,
): SandboxHandle["previews"] {
  return {
    async create(input) {
      const response = await transport.request<CreatePreviewResponse>(
        `/v1/sandboxes/${sandboxId}/previews`,
        { body: input, method: "POST" },
      );
      return response;
    },
    async get(previewId) {
      const response = await transport.request<GetPreviewResponse>(
        `/v1/previews/${previewId}`,
        { method: "GET" },
      );
      return response.preview;
    },
    async list(input = {}) {
      const fetchPage = (cursor = input.cursor) =>
        transport.request<ListPreviewsResponse>(
          `/v1/sandboxes/${sandboxId}/previews${queryString(
            paginationParams({ ...input, cursor }),
          )}`,
          { method: "GET", signal: input.signal },
        );
      return createPage(await fetchPage(), fetchPage);
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

export function createSandboxArtifactsClient(
  sandboxId: `sbx_${string}`,
  transport: Transport,
): SandboxHandle["artifacts"] {
  return {
    async create(input) {
      const { idempotencyKey, ...body } = input;
      const response = await transport.request<CreateArtifactResponse>(
        `/v1/sandboxes/${sandboxId}/artifacts`,
        {
          body,
          ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
          idempotent: true,
          method: "POST",
        },
      );
      return response.artifact;
    },
    async delete(artifactId) {
      const response = await transport.request<DeleteArtifactResponse>(
        `/v1/artifacts/${artifactId}`,
        { method: "DELETE" },
      );
      return response.artifact;
    },
    download(artifactId) {
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
    async list(input = {}) {
      const fetchPage = (cursor = input.cursor) =>
        transport.request<ListArtifactsResponse>(
          `/v1/sandboxes/${sandboxId}/artifacts${queryString(
            paginationParams({ ...input, cursor }),
          )}`,
          { method: "GET", signal: input.signal },
        );
      return createPage(await fetchPage(), fetchPage);
    },
  };
}

export function createSandboxCodeClient(
  sandboxId: `sbx_${string}`,
  transport: Transport,
): SandboxHandle["code"] {
  return {
    async createContext(input = {}) {
      const { idempotencyKey, ...body } = input;
      const response = await transport.request<CreateCodeContextResponse>(
        `/v1/sandboxes/${sandboxId}/code/contexts`,
        {
          body: { language: "python", ...body },
          ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
          idempotent: true,
          method: "POST",
        },
      );
      return response.context;
    },
    async deleteContext(contextId) {
      const response = await transport.request<DeleteCodeContextResponse>(
        `/v1/sandboxes/${sandboxId}/code/contexts/${contextId}`,
        { method: "DELETE" },
      );
      return response.context;
    },
    async getContext(contextId) {
      const response = await transport.request<GetCodeContextResponse>(
        `/v1/sandboxes/${sandboxId}/code/contexts/${contextId}`,
        { method: "GET" },
      );
      return response.context;
    },
    async listContexts(input = {}) {
      const fetchPage = (cursor = input.cursor) =>
        transport.request<ListCodeContextsResponse>(
          `/v1/sandboxes/${sandboxId}/code/contexts${queryString(
            paginationParams({ ...input, cursor }),
          )}`,
          { method: "GET", signal: input.signal },
        );
      return createPage(await fetchPage(), fetchPage);
    },
    async run(input) {
      const { idempotencyKey, ...body } = input;
      const response = await transport.request<RunCodeResponse>(
        `/v1/sandboxes/${sandboxId}/code/runs`,
        {
          body: { language: "python", ...body },
          ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
          idempotent: true,
          method: "POST",
        },
      );
      return response.run;
    },
    runStream(input) {
      const { idempotencyKey, ...body } = input;
      return transport.streamSse<CodeRunEvent>(
        `/v1/sandboxes/${sandboxId}/code/runs/stream`,
        {
          body: { language: "python", ...body },
          ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
          idempotent: true,
          method: "POST",
        },
      );
    },
  };
}
