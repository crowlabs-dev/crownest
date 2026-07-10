/* eslint-disable max-lines -- Workspace Run CLI actions share archive parsing and streaming helpers. */

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";

import type {
  CreateWorkspaceRunInput,
  CrowNestClient,
  WorkspaceRunsClient,
} from "@crownest/sdk";

import { apiGet } from "./api-request";
import { CLI_EXIT_API_ERROR, CLI_EXIT_OK } from "./exit-codes";
import {
  booleanFlag,
  jsonFlagSpec,
  parseFlags,
  rejectExtraPositionals,
  requiredArg,
  requiredPrefixedArg,
  stringArrayFlag,
  stringFlag,
  UsageError,
} from "./flags";
import type { CliEnvironment, CliOutput, CliResult } from "./index";
import { jsonEnvelope, jsonPageEnvelope, renderList, renderRecord } from "./output";
import {
  collectPages,
  type Page,
  paginationFlagSpec,
  paginationOptions,
  paginationSearchParams,
} from "./pagination";

type WorkspaceRunCommandOptions = {
  readonly environment?: CliEnvironment | undefined;
  readonly fetchImpl?: typeof fetch | undefined;
  readonly output?: CliOutput | undefined;
};

type Mutable<T> = { -readonly [Key in keyof T]: T[Key] };

type WorkspaceRunCreateDraft = Mutable<Omit<CreateWorkspaceRunInput, "command">> & {
  command?: string;
};

export async function workspaceRunCommand(
  client: () => CrowNestClient,
  action: string | undefined,
  args: readonly string[],
  options: WorkspaceRunCommandOptions = {},
): Promise<CliResult> {
  switch (action) {
    case undefined:
      throw new UsageError(
        "workspace-runs action must be create, upload, start, run-archive, status, list, logs, cancel, or evidence.",
      );
    case "cancel":
      return cancelWorkspaceRun(client, args);
    case "create":
      return createWorkspaceRun(client, args);
    case "evidence":
      return evidenceWorkspaceRun(client, args);
    case "list":
      return listWorkspaceRuns(client, args, options);
    case "logs":
      return logsWorkspaceRun(client, args, options.output);
    case "run-archive":
      return runArchiveWorkspaceRun(client, args, options.output);
    case "start":
      return startWorkspaceRun(client, args);
    case "status":
      return statusWorkspaceRun(client, args);
    case "upload":
      return uploadWorkspaceRunArchive(client, args);
    default:
      throw new UsageError(
        "workspace-runs action must be create, upload, start, run-archive, status, list, logs, cancel, or evidence.",
      );
  }
}

async function cancelWorkspaceRun(
  client: () => CrowNestClient,
  args: readonly string[],
): Promise<CliResult> {
  const parsed = parseFlags(args, jsonFlagSpec);
  const workspaceRunId = requiredWorkspaceRunId(parsed.positionals[0]);
  rejectExtraPositionals(parsed.positionals.slice(1), "workspace-runs cancel");
  const run = await client().workspaceRuns.cancel(workspaceRunId);
  return ok(
    booleanFlag(parsed.flags, "--json") ? jsonEnvelope(run) : renderRecord(run),
  );
}

async function createWorkspaceRun(
  client: () => CrowNestClient,
  args: readonly string[],
): Promise<CliResult> {
  const parsed = parseCreateFlags(args);
  rejectExtraPositionals(parsed.positionals, "workspace-runs create");
  const command = requiredArg(stringFlag(parsed.flags, "--command"), "command");
  const run = await client().workspaceRuns.create({
    ...createInput(parsed),
    command,
  });
  return ok(
    booleanFlag(parsed.flags, "--json") ? jsonEnvelope(run) : renderRecord(run),
  );
}

async function evidenceWorkspaceRun(
  client: () => CrowNestClient,
  args: readonly string[],
): Promise<CliResult> {
  const parsed = parseFlags(args, {
    "--output": "string",
    ...jsonFlagSpec,
  });
  const workspaceRunId = requiredWorkspaceRunId(parsed.positionals[0]);
  rejectExtraPositionals(parsed.positionals.slice(1), "workspace-runs evidence");
  const evidence = await client().workspaceRuns.evidence(workspaceRunId);
  const outputPath = stringFlag(parsed.flags, "--output");
  if (outputPath !== undefined) {
    await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
    const result = { path: outputPath };
    return ok(
      booleanFlag(parsed.flags, "--json") ? jsonEnvelope(result) : renderRecord(result),
    );
  }
  return ok(jsonEnvelope(evidence));
}

async function listWorkspaceRuns(
  _client: () => CrowNestClient,
  args: readonly string[],
  commandOptions: WorkspaceRunCommandOptions,
): Promise<CliResult> {
  const parsed = parseFlags(args, {
    ...paginationFlagSpec,
    "--project": "string",
    "--status": "string",
    ...jsonFlagSpec,
  });
  rejectExtraPositionals(parsed.positionals, "workspace-runs list");
  const environment = commandOptions.environment ?? {};
  const options = paginationOptions(parsed.flags);
  const runsPage = await collectPages(options, async (cursor) => {
    const params = paginationSearchParams(options, cursor);
    const projectId = stringFlag(parsed.flags, "--project");
    const status = stringFlag(parsed.flags, "--status");
    if (projectId !== undefined) params.set("projectId", projectId);
    if (status !== undefined) params.set("status", status);
    const query = params.toString();
    return await apiGet<Page<Record<string, unknown>>>(
      environment,
      commandOptions.fetchImpl,
      `/v1/workspace-runs${query.length === 0 ? "" : `?${query}`}`,
    );
  });
  return ok(
    booleanFlag(parsed.flags, "--json")
      ? jsonPageEnvelope(runsPage)
      : renderList(runsPage.data, [
          { key: "id" },
          { key: "status" },
          { key: "templateSlug", label: "template" },
          { key: "exitCode", label: "exit" },
          { key: "createdAt" },
        ]),
  );
}

async function logsWorkspaceRun(
  client: () => CrowNestClient,
  args: readonly string[],
  output: CliOutput | undefined,
): Promise<CliResult> {
  const parsed = parseFlags(args, {
    "--after-seq": "string",
    ...jsonFlagSpec,
  });
  const workspaceRunId = requiredWorkspaceRunId(parsed.positionals[0]);
  rejectExtraPositionals(parsed.positionals.slice(1), "workspace-runs logs");
  const afterSeq = optionalNonNegativeInteger(
    stringFlag(parsed.flags, "--after-seq"),
    "--after-seq",
  );
  let stdout = "";
  const json = booleanFlag(parsed.flags, "--json");
  for await (const event of client().workspaceRuns.streamEvents(workspaceRunId, {
    ...(afterSeq === undefined ? {} : { afterSeq }),
  })) {
    if (json) {
      stdout += writeJsonEvent(event, output);
    } else if (event.type === "stdout") {
      output?.stdout.write(event.data);
      if (!output) stdout += event.data;
    } else if (event.type === "stderr") {
      output?.stderr.write(event.data);
    } else if (event.type === "error") {
      throw new Error(`${event.code}: ${event.message}`);
    }
  }
  return ok(stdout);
}

async function runArchiveWorkspaceRun(
  client: () => CrowNestClient,
  args: readonly string[],
  output: CliOutput | undefined,
): Promise<CliResult> {
  const split = splitCommand(args);
  const parsed = parseCreateFlags(split.before);
  const archivePath = requiredArg(parsed.positionals[0], "archive path");
  rejectExtraPositionals(parsed.positionals.slice(1), "workspace-runs run-archive");
  if (split.command.length === 0) {
    throw new UsageError("command is required after --.");
  }
  const command = split.command.map(shellEscapeArg).join(" ");
  const archive = await readArchiveFile(archivePath);
  const runs = client().workspaceRuns;
  const run = await runs.runArchive({
    archive: {
      body: fileBody(archive.path),
      headers: { "content-length": String(archive.sizeBytes) },
      sha256: archive.sha256,
      sizeBytes: archive.sizeBytes,
    },
    ...createInput(parsed),
    command,
  });
  return collectWorkspaceRunEvents(
    runs,
    run.id,
    booleanFlag(parsed.flags, "--json"),
    output,
  );
}

async function startWorkspaceRun(
  client: () => CrowNestClient,
  args: readonly string[],
): Promise<CliResult> {
  const parsed = parseFlags(args, jsonFlagSpec);
  const workspaceRunId = requiredWorkspaceRunId(parsed.positionals[0]);
  rejectExtraPositionals(parsed.positionals.slice(1), "workspace-runs start");
  const run = await client().workspaceRuns.start(workspaceRunId);
  return ok(
    booleanFlag(parsed.flags, "--json") ? jsonEnvelope(run) : renderRecord(run),
  );
}

async function statusWorkspaceRun(
  client: () => CrowNestClient,
  args: readonly string[],
): Promise<CliResult> {
  const parsed = parseFlags(args, jsonFlagSpec);
  const workspaceRunId = requiredWorkspaceRunId(parsed.positionals[0]);
  rejectExtraPositionals(parsed.positionals.slice(1), "workspace-runs status");
  const run = await client().workspaceRuns.get(workspaceRunId);
  return ok(
    booleanFlag(parsed.flags, "--json") ? jsonEnvelope(run) : renderRecord(run),
  );
}

async function uploadWorkspaceRunArchive(
  client: () => CrowNestClient,
  args: readonly string[],
): Promise<CliResult> {
  const parsed = parseFlags(args, {
    "--sha256": "string",
    ...jsonFlagSpec,
  });
  const workspaceRunId = requiredWorkspaceRunId(parsed.positionals[0]);
  const archivePath = requiredArg(parsed.positionals[1], "archive path");
  rejectExtraPositionals(parsed.positionals.slice(2), "workspace-runs upload");
  const archive = await readArchiveFile(archivePath);
  const expected = stringFlag(parsed.flags, "--sha256");
  if (expected !== undefined && expected !== archive.sha256) {
    throw new UsageError("--sha256 does not match archive contents.");
  }
  const response = await uploadArchive(client().workspaceRuns, workspaceRunId, archive);
  return ok(
    booleanFlag(parsed.flags, "--json")
      ? jsonEnvelope(response)
      : renderRecord(response),
  );
}

function parseCreateFlags(args: readonly string[]) {
  return parseFlags(args, {
    "--command": "string",
    "--idempotency-key": "string",
    "--keep-sandbox": "boolean",
    "--metadata": "string[]",
    "--project": "string",
    "--sandbox": "string",
    "--template": "string",
    "--timeout-ms": "string",
    ...jsonFlagSpec,
  });
}

function createInput(parsed: ReturnType<typeof parseCreateFlags>) {
  const input: WorkspaceRunCreateDraft = {};
  const command = stringFlag(parsed.flags, "--command");
  if (command !== undefined) input.command = command;
  const idempotencyKey = stringFlag(parsed.flags, "--idempotency-key");
  if (idempotencyKey !== undefined) input.idempotencyKey = idempotencyKey;
  if (booleanFlag(parsed.flags, "--keep-sandbox")) input.keepSandbox = true;
  const metadata = metadataFlags(parsed);
  if (Object.keys(metadata).length > 0) input.metadata = metadata;
  const projectId = stringFlag(parsed.flags, "--project");
  if (projectId !== undefined) input.projectId = projectId as `prj_${string}`;
  const sandboxId = stringFlag(parsed.flags, "--sandbox");
  if (sandboxId !== undefined) input.sandboxId = sandboxId as `sbx_${string}`;
  const template = stringFlag(parsed.flags, "--template");
  if (template !== undefined) input.template = template;
  const timeoutMs = optionalPositiveInteger(
    stringFlag(parsed.flags, "--timeout-ms"),
    "--timeout-ms",
  );
  if (timeoutMs !== undefined) input.timeoutMs = timeoutMs;
  return input;
}

async function uploadArchive(
  runs: WorkspaceRunsClient,
  workspaceRunId: `wsr_${string}`,
  archive: {
    readonly path: string;
    readonly sha256: string;
    readonly sizeBytes: number;
  },
) {
  const transfer = await runs.createArchiveTransfer(workspaceRunId, {
    sha256: archive.sha256,
    sizeBytes: archive.sizeBytes,
  });
  await runs.uploadArchiveToTransfer(transfer, {
    body: fileBody(archive.path),
    headers: { "content-length": String(archive.sizeBytes) },
  });
  return runs.finalizeArchive(workspaceRunId, {
    sha256: archive.sha256,
    sizeBytes: archive.sizeBytes,
    uploadId: transfer.id,
  });
}

async function collectWorkspaceRunEvents(
  runs: WorkspaceRunsClient,
  workspaceRunId: `wsr_${string}`,
  json: boolean,
  output: CliOutput | undefined,
): Promise<CliResult> {
  let stdout = "";
  let terminalExitCode = 0;
  let terminalSeen = false;
  for await (const event of runs.streamEvents(workspaceRunId, { reconnect: false })) {
    if (event.type === "terminal") {
      terminalSeen = true;
      terminalExitCode = workspaceRunExitCode(event.workspaceRun);
    }
    if (json) {
      stdout += writeJsonEvent(event, output);
      continue;
    }
    if (event.type === "error") {
      return { exitCode: CLI_EXIT_API_ERROR, stderr: `${event.message}\n`, stdout };
    }
    stdout += writeWorkspaceRunTextEvent(event, output);
  }

  if (!terminalSeen) {
    const latest = await runs.get(workspaceRunId);
    if (!isTerminalWorkspaceRunStatus(latest.status)) {
      return {
        exitCode: CLI_EXIT_API_ERROR,
        stderr: `Workspace Run stream ended before terminal status (${latest.status}).\n`,
        stdout,
      };
    }
    terminalExitCode = workspaceRunExitCode(latest);
  }

  return { exitCode: terminalExitCode, stderr: "", stdout };
}

function workspaceRunExitCode(run: {
  readonly exitCode?: number;
  readonly status: string;
}): number {
  return (
    run.exitCode ?? (run.status === "succeeded" ? CLI_EXIT_OK : CLI_EXIT_API_ERROR)
  );
}

async function readArchiveFile(path: string): Promise<{
  readonly path: string;
  readonly sha256: string;
  readonly sizeBytes: number;
}> {
  const info = await stat(path);
  if (!info.isFile()) {
    throw new UsageError("archive path must be an existing .tar.gz file.");
  }
  if (!path.endsWith(".tar.gz") && !path.endsWith(".tgz")) {
    throw new UsageError("archive path must end with .tar.gz or .tgz.");
  }
  return {
    path,
    sha256: await sha256File(path),
    sizeBytes: info.size,
  };
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = createReadStream(path) as AsyncIterable<Buffer>;
  for await (const chunk of stream) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

function fileBody(path: string): BodyInit {
  return Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>;
}

function metadataFlags(
  parsed: ReturnType<typeof parseCreateFlags>,
): Record<string, string> {
  const metadata: Record<string, string> = {};
  for (const entry of stringArrayFlag(parsed.flags, "--metadata")) {
    const separator = entry.indexOf("=");
    if (separator <= 0) {
      throw new UsageError("--metadata values must be key=value.");
    }
    metadata[entry.slice(0, separator)] = entry.slice(separator + 1);
  }
  return metadata;
}

function optionalNonNegativeInteger(
  value: string | undefined,
  flag: string,
): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new UsageError(`${flag} must be a non-negative integer.`);
  }
  return parsed;
}

function optionalPositiveInteger(
  value: string | undefined,
  flag: string,
): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new UsageError(`${flag} must be a positive integer.`);
  }
  return parsed;
}

function requiredWorkspaceRunId(value: string | undefined): `wsr_${string}` {
  return requiredPrefixedArg(value, "workspace run id", "wsr_") as `wsr_${string}`;
}

function splitCommand(args: readonly string[]): {
  readonly before: readonly string[];
  readonly command: readonly string[];
} {
  const separator = args.indexOf("--");
  return separator === -1
    ? { before: args, command: [] }
    : { before: args.slice(0, separator), command: args.slice(separator + 1) };
}

function ok(stdout: string): CliResult {
  return { exitCode: CLI_EXIT_OK, stderr: "", stdout };
}

function isTerminalWorkspaceRunStatus(status: string): boolean {
  return status === "canceled" || status === "failed" || status === "succeeded";
}

function shellEscapeArg(arg: string): string {
  if (/^[A-Za-z0-9_./:=@%+-]+$/.test(arg)) {
    return arg;
  }

  return `'${arg.replaceAll("'", "'\"'\"'")}'`;
}

function writeJsonEvent(event: unknown, output: CliOutput | undefined): string {
  const json = jsonEnvelope(event);
  output?.stdout.write(json);
  return output ? "" : json;
}

function writeWorkspaceRunTextEvent(
  event: Awaited<ReturnType<WorkspaceRunsClient["streamEvents"]>> extends AsyncIterable<
    infer Event
  >
    ? Event
    : never,
  output: CliOutput | undefined,
): string {
  if (event.type === "stdout") {
    output?.stdout.write(event.data);
    return output ? "" : event.data;
  }
  if (event.type === "stderr") {
    output?.stderr.write(event.data);
  }
  return "";
}

/* eslint-enable max-lines -- End Workspace Run CLI command helpers. */
