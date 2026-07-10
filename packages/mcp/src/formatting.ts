import type { CallToolResult, TextContent } from "@modelcontextprotocol/sdk/types.js";

import type {
  ApiKeyMetadata,
  ArtifactMetadata,
  CodeContextMetadata,
  PreviewMetadata,
  ProjectMetadata,
  SandboxMetadata,
} from "./resource-formatting";
import {
  apiKeyPayload,
  artifactPayload,
  codeContextPayload,
  previewPayload,
  projectPayload,
  sandboxPayload,
} from "./resource-formatting";

const CODE_ERROR_MAX_LENGTH = 2_000;

type CodeOutput =
  | {
      readonly kind: "artifact";
      readonly artifactId: string;
      readonly contentType: string;
      readonly format: string;
      readonly sizeBytes: number;
    }
  | { readonly kind: "inline"; readonly format: string; readonly value: unknown }
  | { readonly kind: "rejected"; readonly format: string; readonly reason: string };

type CodeRunResult = {
  readonly contextId?: string;
  readonly durationMs?: number;
  readonly error?: {
    readonly message: string;
    readonly name?: string;
    readonly traceback?: readonly string[];
  };
  readonly executionCount?: number;
  readonly outputs?: readonly CodeOutput[];
  readonly sandboxId: string;
  readonly stderr?: string;
  readonly stdout?: string;
};

type PaginationMetadata = {
  readonly hasMore: boolean;
  readonly nextCursor?: string;
};

type CommandResult = {
  readonly commandId: string;
  readonly exitCode?: number;
  readonly sandboxId: string;
  readonly status: string;
  readonly stderr?: string;
  readonly stdout?: string;
};

type CommandDetails = {
  readonly cancelMode?: string;
  readonly canceledAt?: string;
  readonly command: string;
  readonly cwd: string;
  readonly durationMs?: number;
  readonly exitCode?: number;
  readonly finishedAt?: string;
  readonly id: string;
  readonly sandboxId: string;
  readonly startedAt?: string;
  readonly status: string;
};

type CommandLogChunk = {
  readonly data: string;
  readonly seq: number;
  readonly stream: string;
};

type FileEntry = {
  readonly path: string;
  readonly sizeBytes?: number;
  readonly type?: string;
};

type FileStat = {
  readonly modifiedAt?: string;
  readonly path: string;
  readonly sizeBytes: number;
  readonly type: string;
};

export function textResult(text: string): CallToolResult {
  return { content: [textContent(text)] };
}

export function jsonTextResult(value: unknown): CallToolResult {
  return textResult(`${JSON.stringify(value, null, 2)}\n`);
}

export function formatCodeRun(result: CodeRunResult): CallToolResult {
  if (result.error !== undefined) {
    const prefix = `sandbox_id: ${result.sandboxId}\n`;
    return {
      content: [textContent(`${prefix}${truncate(formatCodeError(result.error))}`)],
      isError: true,
    };
  }

  const lines = [
    `sandbox_id: ${result.sandboxId}`,
    ...(result.contextId === undefined ? [] : [`context_id: ${result.contextId}`]),
    ...(result.executionCount === undefined
      ? []
      : [`execution_count: ${result.executionCount}`]),
    ...(result.durationMs === undefined ? [] : [`duration_ms: ${result.durationMs}`]),
    `stdout:\n${result.stdout ?? ""}`,
    `stderr:\n${result.stderr ?? ""}`,
    ...formatCodeOutputs(result.outputs ?? []),
  ];

  return textResult(`${lines.join("\n")}\n`);
}

export function formatCommand(command: CommandResult): CallToolResult {
  return textResult(
    [
      `command_id: ${command.commandId}`,
      `sandbox_id: ${command.sandboxId}`,
      `status: ${command.status}`,
      `exit_code: ${command.exitCode ?? ""}`,
      `stdout:\n${command.stdout ?? ""}`,
      `stderr:\n${command.stderr ?? ""}`,
    ].join("\n") + "\n",
  );
}

export function formatCommandDetails(command: CommandDetails): CallToolResult {
  return jsonTextResult({
    cancel_mode: command.cancelMode,
    canceled_at: command.canceledAt,
    command: command.command,
    command_id: command.id,
    cwd: command.cwd,
    duration_ms: command.durationMs,
    exit_code: command.exitCode,
    finished_at: command.finishedAt,
    sandbox_id: command.sandboxId,
    started_at: command.startedAt,
    status: command.status,
  });
}

export function formatCommandLogs(
  commandId: string,
  chunks: readonly CommandLogChunk[],
  maxLines: number,
): CallToolResult {
  const lines = chunks.flatMap((chunk) =>
    splitLogLines(chunk.data).map((line) => `${chunk.stream}: ${line}`),
  );
  const visible = lines.slice(0, maxLines);
  const truncated = lines.length > maxLines;

  return textResult(
    [
      `command_id: ${commandId}`,
      `max_lines: ${maxLines}`,
      `truncated: ${truncated}`,
      "logs:",
      ...visible,
      ...(truncated ? [`[truncated after ${maxLines} lines]`] : []),
    ].join("\n") + "\n",
  );
}

export function formatFiles(
  sandboxId: string,
  files: readonly FileEntry[],
): CallToolResult {
  return jsonTextResult({
    data: files,
    sandbox_id: sandboxId,
  });
}

export function formatFileStat(sandboxId: string, file: FileStat): CallToolResult {
  return jsonTextResult({
    modified_at: file.modifiedAt,
    path: file.path,
    sandbox_id: sandboxId,
    size_bytes: file.sizeBytes,
    type: file.type,
  });
}

export function formatArtifactDownload(
  artifact: ArtifactMetadata,
  bytes: Uint8Array,
): CallToolResult {
  return jsonTextResult({
    artifact_id: artifact.id,
    content_base64: Buffer.from(bytes).toString("base64"),
    content_type: artifact.contentType ?? "application/octet-stream",
  });
}

export function formatArtifact(artifact: ArtifactMetadata): CallToolResult {
  return jsonTextResult(artifactPayload(artifact));
}

export function formatArtifactList(
  sandboxId: string,
  artifacts: readonly ArtifactMetadata[],
  pagination: PaginationMetadata,
): CallToolResult {
  return jsonTextResult({
    data: artifacts.map(artifactPayload),
    has_more: pagination.hasMore,
    next_cursor: pagination.nextCursor ?? null,
    sandbox_id: sandboxId,
  });
}

export function formatSandbox(sandbox: SandboxMetadata): CallToolResult {
  return jsonTextResult(sandboxPayload(sandbox));
}

export function formatSandboxList(
  sandboxes: readonly SandboxMetadata[],
  pagination: PaginationMetadata,
): CallToolResult {
  return jsonTextResult({
    data: sandboxes.map(sandboxPayload),
    has_more: pagination.hasMore,
    next_cursor: pagination.nextCursor ?? null,
  });
}

export function formatPreview(preview: PreviewMetadata): CallToolResult {
  return jsonTextResult(previewPayload(preview));
}

export function formatPreviewCreate(
  preview: PreviewMetadata,
  previewToken?: string,
): CallToolResult {
  return jsonTextResult({
    ...previewPayload(preview),
    preview_token: previewToken,
  });
}

export function formatPreviewList(
  sandboxId: string,
  previews: readonly PreviewMetadata[],
  pagination: PaginationMetadata,
): CallToolResult {
  return jsonTextResult({
    data: previews.map(previewPayload),
    has_more: pagination.hasMore,
    next_cursor: pagination.nextCursor ?? null,
    sandbox_id: sandboxId,
  });
}

export function formatCodeContext(context: CodeContextMetadata): CallToolResult {
  return jsonTextResult(codeContextPayload(context));
}

export function formatCodeContextList(
  sandboxId: string,
  contexts: readonly CodeContextMetadata[],
  pagination: PaginationMetadata,
): CallToolResult {
  return jsonTextResult({
    data: contexts.map(codeContextPayload),
    has_more: pagination.hasMore,
    next_cursor: pagination.nextCursor ?? null,
    sandbox_id: sandboxId,
  });
}

export function formatApiKey(apiKey: ApiKeyMetadata): CallToolResult {
  return jsonTextResult(apiKeyPayload(apiKey));
}

export function formatApiKeyList(
  apiKeys: readonly ApiKeyMetadata[],
  pagination: PaginationMetadata,
): CallToolResult {
  return jsonTextResult({
    data: apiKeys.map(apiKeyPayload),
    has_more: pagination.hasMore,
    next_cursor: pagination.nextCursor ?? null,
  });
}

export function formatProject(project: ProjectMetadata): CallToolResult {
  return jsonTextResult(projectPayload(project));
}

export function formatProjectList(
  projects: readonly ProjectMetadata[],
  pagination: PaginationMetadata,
): CallToolResult {
  return jsonTextResult({
    data: projects.map(projectPayload),
    has_more: pagination.hasMore,
    next_cursor: pagination.nextCursor ?? null,
  });
}

function textContent(text: string): TextContent {
  return { text, type: "text" };
}

function formatCodeOutputs(outputs: readonly CodeOutput[]): readonly string[] {
  return outputs.map((output) => {
    if (output.kind === "artifact") {
      return `artifact: ${output.artifactId} (${output.contentType}, ${output.sizeBytes}B)`;
    }

    if (output.kind === "rejected") {
      return `rejected output: ${output.format} (${output.reason})`;
    }

    return `output (${output.format}): ${formatInlineValue(output.value)}`;
  });
}

function formatInlineValue(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function formatCodeError(error: NonNullable<CodeRunResult["error"]>): string {
  const header =
    error.name === undefined ? error.message : `${error.name}: ${error.message}`;
  const traceback = error.traceback?.join("\n");
  return traceback === undefined ? header : `${header}\n${traceback}`;
}

function truncate(value: string): string {
  if (value.length <= CODE_ERROR_MAX_LENGTH) {
    return value;
  }

  return `${value.slice(0, CODE_ERROR_MAX_LENGTH)}...`;
}

function splitLogLines(data: string): readonly string[] {
  return data.replace(/\r?\n$/u, "").split(/\r?\n/u);
}
