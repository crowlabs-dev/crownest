export type SandboxStatus =
  | "creating"
  | "starting"
  | "ready"
  | "running"
  | "idle"
  | "expiring"
  | "destroyed"
  | "failed";

export type CommandStatus =
  | "queued"
  | "starting"
  | "running"
  | "exited"
  | "failed"
  | "canceled"
  | "timed_out"
  | "killed";

export type CommandCancelMode = "force" | "graceful";

export type CommandLogStream = "stderr" | "stdout";

export type CommandCollectOn = "always" | "success";

export type CommandCollectStatus =
  | "failed"
  | "not_requested"
  | "partial"
  | "pending"
  | "skipped"
  | "succeeded";

export type FileEncoding = "base64" | "utf8";

export type FileType = "directory" | "file";

export type PreviewAuthMode = "authenticated" | "token";

export type Metadata = Readonly<Record<string, string>>;

export type * from "./workspace-runs";

export type UsageMetric =
  | "artifact_bytes_stored"
  | "code_run_invocations"
  | "command_invocations"
  | "compute_unit_seconds"
  | "file_bytes_written"
  | "preview_minutes"
  | "sandbox_creates";

export type Project = {
  readonly id: `prj_${string}`;
  readonly orgId: `org_${string}`;
  readonly name: string;
  readonly createdAt: string;
};

export type UsageEvent = {
  readonly amount: number;
  readonly createdAt: string;
  readonly metric: UsageMetric;
  readonly orgId: `org_${string}`;
  readonly projectId?: `prj_${string}`;
  readonly resourceId?: string;
};

export const ApiKeyScopes = [
  "sandbox:create",
  "sandbox:read",
  "sandbox:kill",
  "sandbox:extend",
  "command:run",
  "command:read",
  "command:cancel",
  "code:run",
  "file:read",
  "file:write",
  "artifact:create",
  "artifact:read",
  "artifact:delete",
  "preview:create",
  "preview:read",
  "preview:revoke",
  "workspace_run:create",
  "workspace_run:read",
  "workspace_run:cancel",
  "backup:create",
  "backup:read",
  "backup:restore",
  "backup:delete",
  "usage:read",
  "api_key:read",
  "api_key:revoke",
  "project:create",
] as const;

export type ApiKeyScope = (typeof ApiKeyScopes)[number];

export type ApiKey = {
  readonly id: `key_${string}`;
  readonly orgId: `org_${string}`;
  readonly name: string;
  readonly prefix: string;
  readonly last4: string;
  readonly projectIds?: readonly `prj_${string}`[];
  readonly scopes: readonly ApiKeyScope[];
  readonly createdByUserId: `usr_${string}`;
  readonly createdAt: string;
  readonly revokedAt?: string;
  readonly lastUsedAt?: string;
};

export type Sandbox = {
  readonly id: `sbx_${string}`;
  readonly orgId: `org_${string}`;
  readonly projectId: `prj_${string}`;
  readonly status: SandboxStatus;
  readonly templateId: `tpl_${string}`;
  readonly templateSlug: string;
  readonly templateVersion: string;
  readonly templateVersionId: `tplv_${string}`;
  readonly ttlMs: number;
  readonly expiresAt: string;
  readonly metadata: Metadata;
  readonly createdAt?: string;
  readonly destroyedAt?: string;
  readonly destroyedReason?:
    | "idle_expired"
    | "platform_cleanup"
    | "ttl_expired"
    | "user_killed";
};

export type Command = {
  readonly id: `cmd_${string}`;
  readonly sandboxId: `sbx_${string}`;
  readonly command: string;
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly status: CommandStatus;
  readonly cancelMode?: CommandCancelMode;
  readonly canceledAt?: string;
  readonly exitCode?: number;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly stdoutTruncated?: boolean;
  readonly stderrTruncated?: boolean;
  readonly startedAt?: string;
  readonly finishedAt?: string;
  readonly durationMs?: number;
  readonly collectErrors?: readonly CommandCollectError[];
  readonly collectStatus?: CommandCollectStatus;
  readonly killedReason?: "sandbox_destroyed";
  readonly terminationSignal?: "SIGKILL" | "SIGTERM";
};

export type CodeLanguage = "python" | "javascript" | "typescript";

export type CodeArtifactPolicy = "inline_only" | "promote";

export type CodeContextRef = {
  readonly id: `cctx_${string}`;
  readonly sandboxId: `sbx_${string}`;
  readonly language: CodeLanguage;
  readonly cwd: string;
  readonly isDefault?: boolean;
  readonly createdAt: string;
  readonly expiresAt?: string;
};

export type CodeExecutionError = {
  readonly name?: string;
  readonly message: string;
  readonly traceback?: readonly string[];
};

export type InlineCodeOutputFormat =
  | "chart"
  | "data"
  | "json"
  | "latex"
  | "markdown"
  | "text";

export type ArtifactCodeOutputFormat =
  | "chart"
  | "data"
  | "html"
  | "jpeg"
  | "json"
  | "png"
  | "svg";

export type RejectedCodeOutputReason =
  | "artifact_scope_required"
  | "output_too_large"
  | "requires_artifact_promotion"
  | "unsafe_active_content"
  | "unsupported_format";

export type InlineCodeOutput = {
  readonly kind: "inline";
  readonly format: InlineCodeOutputFormat;
  readonly value: unknown;
  readonly truncated?: boolean;
};

export type ArtifactCodeOutput = {
  readonly kind: "artifact";
  readonly format: ArtifactCodeOutputFormat;
  readonly artifactId: `art_${string}`;
  readonly contentType: string;
  readonly sizeBytes: number;
};

export type RejectedCodeOutput = {
  readonly kind: "rejected";
  readonly format: string;
  readonly reason: RejectedCodeOutputReason;
};

export type CodeOutput = ArtifactCodeOutput | InlineCodeOutput | RejectedCodeOutput;

export type RunCodeResult = {
  readonly sandboxId: `sbx_${string}`;
  readonly contextId: `cctx_${string}`;
  readonly language: CodeLanguage;
  readonly executionCount: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly stdoutTruncated?: boolean;
  readonly stderrTruncated?: boolean;
  readonly outputs: readonly CodeOutput[];
  readonly error?: CodeExecutionError;
  readonly durationMs?: number;
};

export type CodeRunEvent =
  | { readonly type: "stdout"; readonly data: string }
  | { readonly type: "stderr"; readonly data: string }
  | { readonly type: "output"; readonly data: CodeOutput }
  | { readonly type: "error"; readonly data: CodeExecutionError }
  | { readonly type: "complete"; readonly data: RunCodeResult };

export type CommandCollectRequest = {
  readonly name?: string;
  readonly path: string;
};

export type CommandCollectError = {
  readonly code:
    | "artifact_collect_failed"
    | "file_not_found"
    | "path_outside_workspace";
  readonly message: string;
  readonly path: string;
};

export type CommandLogChunk = {
  readonly commandId: `cmd_${string}`;
  readonly createdAt: string;
  readonly data: string;
  readonly seq: number;
  readonly stream: CommandLogStream;
};

export type Preview = {
  readonly id: `prv_${string}`;
  readonly slug: string;
  readonly orgId: `org_${string}`;
  readonly projectId: `prj_${string}`;
  readonly sandboxId: `sbx_${string}`;
  readonly port: number;
  readonly authMode: PreviewAuthMode;
  readonly url: string;
  readonly createdAt: string;
  readonly expiresAt?: string;
  readonly revokedAt?: string;
};

export type Artifact = {
  readonly id: `art_${string}`;
  readonly orgId: `org_${string}`;
  readonly projectId: `prj_${string}`;
  readonly sandboxId: `sbx_${string}`;
  readonly contentType?: string;
  readonly name: string;
  readonly objectKey: string;
  readonly sizeBytes: number;
  readonly sourcePath?: string;
  readonly createdAt: string;
  readonly deletedAt?: string;
  readonly retentionExpiresAt?: string;
};

export type FileEntry = FileStat & {
  readonly name: string;
};

export type FileStat = {
  readonly modifiedAt?: string;
  readonly path: string;
  readonly sizeBytes: number;
  readonly type: FileType;
};
