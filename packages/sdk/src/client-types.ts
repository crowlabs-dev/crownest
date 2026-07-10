import type {
  ApiKey,
  Artifact,
  ArtifactDownloadUrlResponse,
  CodeArtifactPolicy,
  CodeContextRef,
  CodeLanguage,
  CodeRunEvent,
  Command,
  CommandLogStreamEvent,
  CreatePreviewResponse,
  CreateWorkspaceRunArchiveTransferBody,
  CreateWorkspaceRunBody,
  FileDownloadUrlResponse,
  FileEncoding,
  FileStat,
  FinalizeWorkspaceRunArchiveBody,
  ListCommandLogsResponse,
  ListFilesResponse,
  ListWorkspaceRunEventsResponse,
  Preview,
  PreviewAuthMode,
  Project,
  RunCodeResult,
  UploadWorkspaceRunArchiveRequest,
  UsageSummaryResponse,
  WorkspaceRun,
  WorkspaceRunArchive,
  WorkspaceRunArchiveTransfer,
  WorkspaceRunEvidenceBundle,
  WorkspaceRunStatus,
  WorkspaceRunStreamEvent,
} from "@crownest/contracts";

import type { AutoPage } from "./pagination";
import type { WaitOptions } from "./polling";
import type { RunCommandOptions, StreamRequestOptions } from "./protocol";
import type {
  CreateCodeContextInput,
  RunCodeInput,
  SandboxHandle,
} from "./sandbox-handle";

export type { CodeArtifactPolicy, CodeLanguage };

export type CreateSandboxInput = {
  readonly idempotencyKey?: string;
  readonly metadata?: Readonly<Record<string, string>>;
  readonly projectId?: `prj_${string}`;
  readonly restoreFrom?: `bkp_${string}`;
  readonly template?: string;
  readonly templateVersionId?: `tplv_${string}`;
  readonly ttlMs?: number;
};

export type SetSandboxTtlInput = {
  readonly idempotencyKey?: string;
  readonly ttlMs: number;
};

export type ListSandboxesInput = {
  readonly cursor?: string | undefined;
  readonly limit?: number;
  readonly metadata?: Readonly<Record<string, string>>;
  readonly signal?: AbortSignal | undefined;
};

export type ListSandboxHandlesResponse = AutoPage<SandboxHandle>;

export type WaitUntilReadyInput = WaitOptions;

export type ListInput = {
  readonly cursor?: string | undefined;
  readonly limit?: number;
  readonly signal?: AbortSignal | undefined;
};

export type CreateWorkspaceRunInput = CreateWorkspaceRunBody & {
  readonly idempotencyKey?: string;
};

export type UploadWorkspaceRunArchiveInput = UploadWorkspaceRunArchiveRequest & {
  readonly idempotencyKey?: string;
};

export type UploadWorkspaceRunArchiveTransferInput = {
  readonly body: BodyInit;
  readonly headers?: HeadersInit;
};

export type RunWorkspaceRunArchiveInput = CreateWorkspaceRunBody & {
  readonly archive: {
    readonly body: BodyInit;
    readonly headers?: HeadersInit;
    readonly sha256: string;
    readonly sizeBytes: number;
  };
  readonly idempotencyKey?: string;
};

export type RunWorkspaceRunInput = CreateWorkspaceRunBody & {
  readonly archive: {
    readonly body: BodyInit;
    readonly sha256: string;
    readonly sizeBytes: number;
  };
  readonly idempotencyKey?: string;
  /** Resolve with the terminal run instead of the started run. */
  readonly wait?: boolean;
  readonly waitOptions?: WaitForTerminalInput;
};

export type CreateWorkspaceRunArchiveTransferInput =
  CreateWorkspaceRunArchiveTransferBody & {
    readonly idempotencyKey?: string;
  };

export type FinalizeWorkspaceRunArchiveInput = FinalizeWorkspaceRunArchiveBody & {
  readonly idempotencyKey?: string;
};

export type StartWorkspaceRunInput = {
  readonly idempotencyKey?: string;
};

export type ListWorkspaceRunsInput = {
  readonly cursor?: string | undefined;
  readonly limit?: number;
  readonly metadata?: Readonly<Record<string, string>>;
  readonly projectId?: `prj_${string}`;
  readonly status?: WorkspaceRunStatus;
  readonly signal?: AbortSignal | undefined;
};

export type WorkspaceRunEventsInput = StreamRequestOptions & {
  readonly afterSeq?: number;
  readonly limit?: number;
  readonly reconnect?: boolean;
};

export type CommandStreamInput = StreamRequestOptions & {
  readonly afterSeq?: number;
  readonly reconnect?: boolean;
};

export type WaitForTerminalInput = WaitOptions;
export type WaitUntilDoneInput = WaitForTerminalInput;

export type WaitForCommandInput = WaitOptions;

export type WorkspaceRunsClient = {
  /** Create a Workspace Run record before archive upload. */
  create(input: CreateWorkspaceRunInput): Promise<WorkspaceRun>;
  /** Cancel active Workspace Run orchestration. */
  cancel(workspaceRunId: `wsr_${string}`): Promise<WorkspaceRun>;
  /** Create a staged archive transfer target for larger archives. */
  createArchiveTransfer(
    workspaceRunId: `wsr_${string}`,
    input: CreateWorkspaceRunArchiveTransferInput,
  ): Promise<WorkspaceRunArchiveTransfer>;
  /** Read the durable Evidence Bundle for a completed Workspace Run. */
  evidence(workspaceRunId: `wsr_${string}`): Promise<WorkspaceRunEvidenceBundle>;
  /** Finalize a staged archive transfer after direct upload. */
  finalizeArchive(
    workspaceRunId: `wsr_${string}`,
    input: FinalizeWorkspaceRunArchiveInput,
  ): Promise<{
    readonly archive: WorkspaceRunArchive;
    readonly workspaceRun: WorkspaceRun;
  }>;
  /** Retrieve Workspace Run metadata. */
  get(workspaceRunId: `wsr_${string}`): Promise<WorkspaceRun>;
  /** List Workspace Runs visible to the configured credential. */
  list(input?: ListWorkspaceRunsInput): Promise<AutoPage<WorkspaceRun>>;
  /** Replay bounded Workspace Run events without opening an SSE stream. */
  listEvents(
    workspaceRunId: `wsr_${string}`,
    input?: WorkspaceRunEventsInput,
  ): Promise<ListWorkspaceRunEventsResponse>;
  /** Create, upload, finalize, and start a Workspace Run from archive bytes. */
  runArchive(input: RunWorkspaceRunArchiveInput): Promise<WorkspaceRun>;
  /**
   * Create, upload, and start a Workspace Run. Archives up to 8 MiB use direct
   * upload; larger archives use a staged transfer. Set `wait` to return the
   * terminal run instead of the started run.
   */
  run(input: RunWorkspaceRunInput): Promise<WorkspaceRun>;
  /** Start extraction and command execution for an uploaded Workspace Run. */
  start(
    workspaceRunId: `wsr_${string}`,
    input?: StartWorkspaceRunInput,
  ): Promise<WorkspaceRun>;
  /** Stream Workspace Run events with optional reconnect support. */
  streamEvents(
    workspaceRunId: `wsr_${string}`,
    input?: WorkspaceRunEventsInput,
  ): AsyncIterable<WorkspaceRunStreamEvent>;
  /** Poll until a Workspace Run reaches a terminal status. */
  waitUntilDone(
    workspaceRunId: `wsr_${string}`,
    input?: WaitForTerminalInput,
  ): Promise<WorkspaceRun>;
  /** Upload a small archive through the API Worker path. */
  uploadArchive(
    workspaceRunId: `wsr_${string}`,
    input: UploadWorkspaceRunArchiveInput,
  ): Promise<{
    readonly archive: WorkspaceRunArchive;
    readonly workspaceRun: WorkspaceRun;
  }>;
  /** Upload an archive body to a staged transfer target. */
  uploadArchiveToTransfer(
    transfer: WorkspaceRunArchiveTransfer,
    input: UploadWorkspaceRunArchiveTransferInput,
  ): Promise<void>;
};

export type CreateProjectInput = {
  readonly name: string;
};

export type CrowNestClient = {
  readonly apiKeys: {
    /** Retrieve API Key metadata by id. */
    get(apiKeyId: `key_${string}`): Promise<ApiKey>;
    /** List API Key metadata visible to the configured credential. */
    list(input?: ListInput): Promise<AutoPage<ApiKey>>;
    /** Revoke an API Key immediately. */
    revoke(apiKeyId: `key_${string}`): Promise<ApiKey>;
  };
  readonly artifacts: {
    /** Export a Workspace file from a Sandbox as a durable Artifact. */
    create(
      sandboxId: `sbx_${string}`,
      input: {
        readonly idempotencyKey?: string;
        readonly name?: string;
        readonly path: string;
      },
    ): Promise<Artifact>;
    /** Delete an Artifact by id. */
    delete(artifactId: `art_${string}`): Promise<Artifact>;
    /** Download Artifact bytes. */
    download(artifactId: `art_${string}`): Promise<Uint8Array>;
    /** Create or reuse a short-lived Artifact download URL. */
    downloadUrl(artifactId: `art_${string}`): Promise<ArtifactDownloadUrlResponse>;
    /** Retrieve Artifact metadata by id. */
    get(artifactId: `art_${string}`): Promise<Artifact>;
    /** List Artifacts exported from a Sandbox. */
    list(sandboxId: `sbx_${string}`, input?: ListInput): Promise<AutoPage<Artifact>>;
  };
  readonly commands: {
    /** Cancel a running Command. */
    cancel(
      commandId: `cmd_${string}`,
      input?: { readonly mode?: "force" | "graceful" },
    ): Promise<Command>;
    /** Retrieve Command metadata by id. */
    get(commandId: `cmd_${string}`): Promise<Command>;
    /** Read bounded Command log chunks. */
    logs(
      commandId: `cmd_${string}`,
      input?: { readonly afterSeq?: number; readonly limit?: number },
    ): Promise<ListCommandLogsResponse>;
    /** Poll until a Command reaches a terminal status. */
    wait(commandId: `cmd_${string}`, input?: WaitForCommandInput): Promise<Command>;
    /** Run a Command, waiting unless `background` is true. */
    run(
      sandboxId: `sbx_${string}`,
      command: string,
      input?: RunCommandOptions,
    ): Promise<Command>;
    /** Stream Command log events with optional reconnect support. */
    streamLogs(
      commandId: `cmd_${string}`,
      input?: CommandStreamInput,
    ): AsyncIterable<CommandLogStreamEvent>;
  };
  readonly code: {
    /** Create a Code Context in a Sandbox. */
    createContext(
      sandboxId: `sbx_${string}`,
      input?: CreateCodeContextInput,
    ): Promise<CodeContextRef>;
    /** Delete a Code Context from a Sandbox. */
    deleteContext(
      sandboxId: `sbx_${string}`,
      contextId: `cctx_${string}`,
    ): Promise<CodeContextRef>;
    /** Retrieve Code Context metadata. */
    getContext(
      sandboxId: `sbx_${string}`,
      contextId: `cctx_${string}`,
    ): Promise<CodeContextRef>;
    /** List Code Contexts in a Sandbox. */
    listContexts(
      sandboxId: `sbx_${string}`,
      input?: ListInput,
    ): Promise<AutoPage<CodeContextRef>>;
    /** Run interpreter code in a Sandbox. */
    run(sandboxId: `sbx_${string}`, input: RunCodeInput): Promise<RunCodeResult>;
    /** Stream interpreter code execution events. */
    runStream(
      sandboxId: `sbx_${string}`,
      input: RunCodeInput,
    ): AsyncIterable<CodeRunEvent>;
  };
  readonly files: {
    /** Delete a Workspace file or empty directory. */
    delete(sandboxId: `sbx_${string}`, path: string): Promise<void>;
    /** Create or reuse a short-lived download URL for a Workspace file. */
    downloadUrl(
      sandboxId: `sbx_${string}`,
      path: string,
    ): Promise<FileDownloadUrlResponse>;
    /** List entries in a Workspace directory. */
    list(sandboxId: `sbx_${string}`, path?: string): Promise<ListFilesResponse>;
    /** Create a Workspace directory. */
    mkdir(
      sandboxId: `sbx_${string}`,
      path: string,
      input?: { readonly parents?: boolean },
    ): Promise<FileStat>;
    /** Move or rename a Workspace file or directory. */
    move(
      sandboxId: `sbx_${string}`,
      from: string,
      to: string,
      input?: { readonly overwrite?: boolean },
    ): Promise<FileStat>;
    /** Read a small Workspace file as text. */
    read(
      sandboxId: `sbx_${string}`,
      path: string,
      input?: { readonly encoding?: FileEncoding },
    ): Promise<string>;
    /**
     * Reads a small file as bytes through the direct base64 API. Direct payloads
     * are capped by the API's maxDirectFileReadBytes; use downloadUrl or
     * artifacts for larger files.
     */
    readBytes(sandboxId: `sbx_${string}`, path: string): Promise<Uint8Array>;
    /** Inspect Workspace file metadata. */
    stat(sandboxId: `sbx_${string}`, path: string): Promise<FileStat>;
    /** Write a small Workspace text file. */
    write(
      sandboxId: `sbx_${string}`,
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
      sandboxId: `sbx_${string}`,
      path: string,
      bytes: Uint8Array,
      input?: {
        readonly createParents?: boolean;
        readonly overwrite?: boolean;
      },
    ): Promise<FileStat>;
  };
  readonly previews: {
    /** Create a Preview for a Sandbox port. */
    create(
      sandboxId: `sbx_${string}`,
      input: { readonly authMode?: PreviewAuthMode; readonly port: number },
    ): Promise<CreatePreviewResponse>;
    /** Retrieve Preview metadata by id. */
    get(previewId: `prv_${string}`): Promise<Preview>;
    /** List Previews for a Sandbox. */
    list(sandboxId: `sbx_${string}`, input?: ListInput): Promise<AutoPage<Preview>>;
    /** Revoke a Preview by id. */
    revoke(previewId: `prv_${string}`): Promise<Preview>;
  };
  readonly projects: {
    /** Create a Project in the configured organization. */
    create(input: CreateProjectInput): Promise<Project>;
    /** List Projects visible to the configured credential. */
    list(input?: ListInput): Promise<AutoPage<Project>>;
  };
  readonly sandboxes: {
    /** Create a live Sandbox. */
    create(input?: CreateSandboxInput): Promise<SandboxHandle>;
    /** Set the Sandbox TTL and reset its expiration countdown from now. */
    setTtl(
      sandboxId: `sbx_${string}`,
      input: SetSandboxTtlInput,
    ): Promise<SandboxHandle>;
    /** Retrieve a Sandbox handle with bound Command, file, and lifecycle helpers. */
    get(sandboxId: `sbx_${string}`): Promise<SandboxHandle>;
    /** Kill a live Sandbox and return its updated handle. */
    kill(sandboxId: `sbx_${string}`): Promise<SandboxHandle>;
    /** List live Sandboxes visible to the configured credential. */
    list(input?: ListSandboxesInput): Promise<ListSandboxHandlesResponse>;
  };
  readonly workspaceRuns: WorkspaceRunsClient;
  /** Read current compute usage, spend metadata, and quota buckets. */
  usage(): Promise<UsageSummaryResponse>;
};
