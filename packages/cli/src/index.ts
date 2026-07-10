#!/usr/bin/env -S node --import tsx

/* eslint-disable max-lines -- The CLI router intentionally stays with the canonical command table that check-cli-surface greps. */

import { realpathSync } from "node:fs";
import { writeFile as writeFileBytes } from "node:fs/promises";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import {
  createCrowNestClient,
  CrowNestApiError,
  type CrowNestClient,
  type CrowNestClientOptions,
} from "@crownest/sdk";

import packageJson from "../package.json";
import {
  apiGet,
  apiPost,
  authenticatedFetch,
  configuredCredential,
  throwApiResponse,
} from "./api-request";
import { codeRunCommand } from "./code-commands";
import { loadCredentialConfig } from "./credential-config";
import {
  CLI_EXIT_API_ERROR,
  CLI_EXIT_OK,
  CLI_EXIT_USAGE_ERROR,
  sandboxCommandExitCode,
} from "./exit-codes";
import {
  deleteFileCommand,
  downloadFileCommand,
  listFilesCommand,
  mkdirCommand,
  moveFileCommand,
  readFileCommand,
  statFileCommand,
  uploadFileCommand,
  writeFileCommand,
} from "./file-commands";
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
import { helpOutput } from "./help";
import {
  createApiKeyCommand,
  listApiKeysCommand,
  loginCommand,
} from "./human-commands";
import {
  jsonEnvelope,
  jsonErrorEnvelope,
  jsonPageEnvelope,
  renderList,
  renderRecord,
} from "./output";
import {
  collectPages,
  type Page,
  paginationFlagSpec,
  paginationOptions,
  paginationSearchParams,
} from "./pagination";
import {
  createPreviewCommand,
  listPreviewsCommand,
  revokePreviewCommand,
} from "./preview-commands";
import { shellCommand } from "./shell-command";
import { installSkillCommand } from "./skill-commands";
import { workspaceRunCommand } from "./workspace-run-commands";

export const cliName = "crownest";

export { CLI_EXIT_API_ERROR, CLI_EXIT_OK, CLI_EXIT_USAGE_ERROR };

export const canonicalCliCommands = [
  "login",
  "usage",
  "whoami",
  "projects list",
  "keys create",
  "keys list",
  "sandboxes create",
  "sandboxes get",
  "sandboxes list",
  "sandboxes kill",
  "sandboxes set-ttl",
  "commands run",
  "commands get",
  "commands cancel",
  "logs",
  "shell",
  "skills install",
  "code run",
  "files read",
  "files write",
  "files upload",
  "files download",
  "files list",
  "files stat",
  "files mkdir",
  "files move",
  "files delete",
  "artifacts create",
  "artifacts list",
  "artifacts download",
  "artifacts delete",
  "previews create",
  "previews list",
  "previews revoke",
  "workspace-runs create",
  "workspace-runs upload",
  "workspace-runs start",
  "workspace-runs run-archive",
  "workspace-runs status",
  "workspace-runs list",
  "workspace-runs logs",
  "workspace-runs cancel",
  "workspace-runs evidence",
] as const;

export type CanonicalCliCommand = (typeof canonicalCliCommands)[number];

export type CliResult = {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
};

export type CliEnvironment = {
  readonly CROWNEST_API_KEY?: string;
  readonly CROWNEST_API_URL?: string;
  readonly CROWNEST_BEARER_TOKEN?: string;
  readonly CROWNEST_CONFIG_PATH?: string;
  readonly CROWNEST_DASHBOARD_URL?: string;
  readonly CROWNEST_ORG_ID?: string;
  readonly CROWNEST_ROLE?: string;
  readonly CROWNEST_USER_ID?: string;
  readonly HOME?: string;
  readonly XDG_CONFIG_HOME?: string;
};

export type CliOutput = {
  readonly stderr: { write(chunk: string): void };
  readonly stdout: { write(chunk: string): void };
};

export type CliInput = AsyncIterable<string> | Iterable<string>;

type ApiKeyListPayload = {
  readonly data?: readonly Record<string, unknown>[];
  readonly error?: {
    readonly code?: string;
    readonly details?: Readonly<Record<string, unknown>>;
    readonly message?: string;
  };
  readonly hasMore?: boolean;
  readonly nextCursor?: string;
};

type ApiKeyMetadataLookup = {
  readonly metadata?: Record<string, unknown>;
  readonly missingScope?: "api_key:read";
};

type CommandRunOptions = {
  readonly background: boolean;
  readonly collect?: readonly { readonly path: string }[];
  readonly collectOn?: "always" | "success";
};

type CommandResult = {
  readonly exitCode?: number;
} & Record<string, unknown>;

// eslint-disable-next-line complexity, max-lines-per-function -- Routing mirrors the public CLI command surface.
export async function runCli(
  argv: readonly string[],
  environment: CliEnvironment = {},
  fetchImpl?: typeof fetch,
  output?: CliOutput,
  input?: CliInput,
): Promise<CliResult> {
  const wantsJson = wantsJsonOutput(argv);

  if (argv[0] === "--version" || argv[0] === "-V") {
    return ok(`${packageJson.version}\n`);
  }

  const requestedHelp = helpOutput(argv);
  if (requestedHelp !== undefined) {
    return ok(requestedHelp);
  }

  const [resource, action, ...rest] = argv;
  // Lazy: `login` must work before any credential exists, and the SDK now
  // fails fast at construction when no API key is available.
  let clientInstance: ReturnType<typeof createCrowNestClient> | undefined;
  const client = () => {
    clientInstance ??= createCrowNestClient(clientOptions(environment, fetchImpl));
    return clientInstance;
  };
  const command = `${resource ?? ""} ${action ?? ""}`;
  const handlers: Record<string, () => Promise<CliResult>> = {
    "keys create": () => createApiKeyCommand(rest, environment, fetchImpl),
    "keys list": () => listApiKeysCommand(rest, environment, fetchImpl),
    "commands cancel": () => cancelCommand(client, rest),
    "commands get": () => getCommand(client, rest),
    "commands run": () => runCommand(rest, environment, fetchImpl),
    "code run": () => codeRunCommand(client, rest, output),
    "artifacts create": () => createArtifact(client, rest),
    "artifacts delete": () => deleteArtifact(client, rest),
    "artifacts download": () => downloadArtifact(client, rest),
    "artifacts list": () => listArtifacts(rest, environment, fetchImpl),
    "files delete": () => deleteFileCommand(client, rest),
    "files download": () => downloadFileCommand(client, rest),
    "files list": () => listFilesCommand(client, rest),
    "files mkdir": () => mkdirCommand(client, rest),
    "files move": () => moveFileCommand(client, rest),
    "files read": () => readFileCommand(client, rest),
    "files stat": () => statFileCommand(client, rest),
    "files upload": () => uploadFileCommand(client, rest),
    "files write": () => writeFileCommand(client, rest, input),
    "previews create": () => createPreviewCommand(client, rest),
    "previews list": () => listPreviewsCommand(client, rest, environment, fetchImpl),
    "previews revoke": () => revokePreviewCommand(client, rest),
    "projects list": () => listProjects(rest, environment, fetchImpl),
    "sandboxes create": () => createSandbox(client, rest),
    "sandboxes get": () => getSandbox(client, rest),
    "sandboxes kill": () => killSandbox(client, rest),
    "sandboxes list": () => listSandboxes(rest, environment, fetchImpl),
    "sandboxes set-ttl": () => setSandboxTtl(rest, environment, fetchImpl),
    "skills install": () => installSkillCommand(rest, environment),
  };
  const handler =
    resource === "logs"
      ? () => logs(client, [action, ...rest], output)
      : resource === "login"
        ? () => Promise.resolve(loginCommand(compact([action, ...rest]), environment))
        : resource === "usage"
          ? () => usageCommand(client, compact([action, ...rest]))
          : resource === "whoami"
            ? () => whoamiCommand(compact([action, ...rest]), environment, fetchImpl)
            : resource === "shell"
              ? () =>
                  shellCommand(client, compact([action, ...rest]), input, output, {
                    environment,
                    fetchImpl,
                  })
              : resource === "workspace-runs"
                ? () =>
                    workspaceRunCommand(client, action, rest, {
                      environment,
                      fetchImpl,
                      output,
                    })
                : handlers[command];

  try {
    if (handler) return normalizeCliResult(await handler(), wantsJson);

    return failError(
      {
        code: "unknown_command",
        message: `Unknown command: ${argv.join(" ") || "(empty)"}. Run \`crownest --help\` for the command list.`,
      },
      CLI_EXIT_USAGE_ERROR,
      wantsJson,
    );
  } catch (error) {
    if (error instanceof UsageError) {
      return failError(
        { code: "usage_error", message: error.message },
        CLI_EXIT_USAGE_ERROR,
        wantsJson,
      );
    }
    if (error instanceof CrowNestApiError) {
      return failApiError(error, wantsJson);
    }
    return failError(
      {
        code: "runtime_error",
        message: error instanceof Error ? error.message : String(error),
      },
      CLI_EXIT_API_ERROR,
      wantsJson,
    );
  }
}

async function createSandbox(
  client: () => CrowNestClient,
  args: readonly string[],
): Promise<CliResult> {
  const parsed = parseFlags(args, {
    "--project": "string",
    "--template": "string",
    ...jsonFlagSpec,
  });
  rejectExtraPositionals(parsed.positionals, "sandboxes create");
  const projectId = stringFlag(parsed.flags, "--project") as
    | `prj_${string}`
    | undefined;
  const template = stringFlag(parsed.flags, "--template");
  const sandbox = await client().sandboxes.create({
    ...(projectId === undefined ? {} : { projectId }),
    ...(template === undefined ? {} : { template }),
  });

  return ok(
    booleanFlag(parsed.flags, "--json") ? jsonEnvelope(sandbox) : renderRecord(sandbox),
  );
}

async function listSandboxes(
  args: readonly string[],
  environment: CliEnvironment,
  fetchImpl: typeof fetch | undefined,
): Promise<CliResult> {
  const parsed = parseFlags(args, { ...paginationFlagSpec, ...jsonFlagSpec });
  rejectExtraPositionals(parsed.positionals, "sandboxes list");
  const options = paginationOptions(parsed.flags);
  const sandboxesPage = await collectPages(options, (cursor) =>
    apiListPage<Record<string, unknown>>(
      environment,
      fetchImpl,
      "/v1/sandboxes",
      options,
      cursor,
    ),
  );
  return ok(
    booleanFlag(parsed.flags, "--json")
      ? jsonPageEnvelope(sandboxesPage)
      : renderList(sandboxesPage.data, [
          { key: "id" },
          { key: "status" },
          { key: "templateSlug", label: "template" },
          { key: "expiresAt" },
        ]),
  );
}

async function getSandbox(
  client: () => CrowNestClient,
  args: readonly string[],
): Promise<CliResult> {
  const parsed = parseFlags(args, jsonFlagSpec);
  const sandboxId = requiredSandboxId(parsed.positionals[0], "sandbox id");
  rejectExtraPositionals(parsed.positionals.slice(1), "sandboxes get");
  const sandbox = await client().sandboxes.get(sandboxId);
  return ok(
    booleanFlag(parsed.flags, "--json") ? jsonEnvelope(sandbox) : renderRecord(sandbox),
  );
}

async function setSandboxTtl(
  args: readonly string[],
  environment: CliEnvironment,
  fetchImpl: typeof fetch | undefined,
): Promise<CliResult> {
  const parsed = parseFlags(args, {
    "--ttl-ms": "string",
    ...jsonFlagSpec,
  });
  const ttlMs = positiveIntegerFlag(parsed.flags, "--ttl-ms");
  const sandboxId = requiredSandboxId(parsed.positionals[0], "sandbox id");
  rejectExtraPositionals(parsed.positionals.slice(1), "sandboxes set-ttl");
  const response = await apiPost<{ readonly sandbox: Record<string, unknown> }>(
    environment,
    fetchImpl,
    `/v1/sandboxes/${sandboxId}/ttl`,
    { ttlMs },
  );
  return ok(
    booleanFlag(parsed.flags, "--json")
      ? jsonEnvelope(response.sandbox)
      : renderRecord(response.sandbox),
  );
}

async function listProjects(
  args: readonly string[],
  environment: CliEnvironment,
  fetchImpl: typeof fetch | undefined,
): Promise<CliResult> {
  const parsed = parseFlags(args, { ...paginationFlagSpec, ...jsonFlagSpec });
  rejectExtraPositionals(parsed.positionals, "projects list");
  const options = paginationOptions(parsed.flags);
  const projectsPage = await collectPages(options, (cursor) =>
    apiListPage<Record<string, unknown>>(
      environment,
      fetchImpl,
      "/v1/projects",
      options,
      cursor,
    ),
  );
  return ok(
    booleanFlag(parsed.flags, "--json")
      ? jsonPageEnvelope(projectsPage)
      : renderList(projectsPage.data, [
          { key: "id" },
          { key: "name" },
          { key: "orgId" },
        ]),
  );
}

async function killSandbox(
  client: () => CrowNestClient,
  args: readonly string[],
): Promise<CliResult> {
  const parsed = parseFlags(args, jsonFlagSpec);
  const sandboxId = requiredSandboxId(parsed.positionals[0], "sandbox id");
  rejectExtraPositionals(parsed.positionals.slice(1), "sandboxes kill");
  const killed = await client().sandboxes.kill(sandboxId);
  return ok(
    booleanFlag(parsed.flags, "--json") ? jsonEnvelope(killed) : renderRecord(killed),
  );
}

async function runCommand(
  args: readonly string[],
  environment: CliEnvironment,
  fetchImpl: typeof fetch | undefined,
): Promise<CliResult> {
  return await executeCommand(args, environment, fetchImpl);
}

async function cancelCommand(
  client: () => CrowNestClient,
  args: readonly string[],
): Promise<CliResult> {
  const parsed = parseFlags(args, {
    "--force": "boolean",
    ...jsonFlagSpec,
  });
  const commandId = requiredArg(parsed.positionals[0], "command id");
  rejectExtraPositionals(parsed.positionals.slice(1), "commands cancel");
  const command = await client().commands.cancel(commandId as `cmd_${string}`, {
    mode: booleanFlag(parsed.flags, "--force") ? "force" : "graceful",
  });
  return ok(
    booleanFlag(parsed.flags, "--json") ? jsonEnvelope(command) : renderRecord(command),
  );
}

async function getCommand(
  client: () => CrowNestClient,
  args: readonly string[],
): Promise<CliResult> {
  const parsed = parseFlags(args, jsonFlagSpec);
  const commandId = requiredPrefixedArg(
    parsed.positionals[0],
    "command id",
    "cmd_",
  ) as `cmd_${string}`;
  rejectExtraPositionals(parsed.positionals.slice(1), "commands get");
  const command = await client().commands.get(commandId);
  return ok(
    booleanFlag(parsed.flags, "--json") ? jsonEnvelope(command) : renderRecord(command),
  );
}

async function logs(
  client: () => CrowNestClient,
  args: readonly (string | undefined)[],
  output: CliOutput | undefined,
): Promise<CliResult> {
  const parsed = parseFlags(compact(args), {
    "--command": "string",
    ...jsonFlagSpec,
  });
  const target = requiredArg(parsed.positionals[0], "command id");
  const commandId = target.startsWith("cmd_")
    ? target
    : stringFlag(parsed.flags, "--command");

  if (!commandId?.startsWith("cmd_")) {
    throw new UsageError(
      "command id is required. Use logs cmd_... or logs sbx_... --command cmd_...",
    );
  }
  rejectExtraPositionals(parsed.positionals.slice(1), "logs");

  let stdout = "";
  for await (const event of client().commands.streamLogs(
    commandId as `cmd_${string}`,
  )) {
    if (event.type === "log") {
      if (output) {
        const stream = event.stream === "stderr" ? output.stderr : output.stdout;
        stream.write(event.data);
      } else {
        stdout += event.data;
      }
    } else if (event.type === "error") {
      throw new Error(`${event.code}: ${event.message}`);
    }
  }

  return ok(stdout);
}

async function createArtifact(
  client: () => CrowNestClient,
  args: readonly string[],
): Promise<CliResult> {
  const parsed = parseFlags(args, {
    "--name": "string",
    ...jsonFlagSpec,
  });
  const name = stringFlag(parsed.flags, "--name");
  const sandboxId = requiredSandboxId(parsed.positionals[0], "sandbox id");
  const path = requiredArg(parsed.positionals[1], "path");
  rejectExtraPositionals(parsed.positionals.slice(2), "artifacts create");
  const artifact = await client().artifacts.create(sandboxId, {
    path,
    ...(name === undefined ? {} : { name }),
  });
  return ok(
    booleanFlag(parsed.flags, "--json")
      ? jsonEnvelope(artifact)
      : renderRecord(artifact),
  );
}

async function listArtifacts(
  args: readonly string[],
  environment: CliEnvironment,
  fetchImpl: typeof fetch | undefined,
): Promise<CliResult> {
  const parsed = parseFlags(args, { ...paginationFlagSpec, ...jsonFlagSpec });
  const sandboxId = requiredSandboxId(parsed.positionals[0], "sandbox id");
  rejectExtraPositionals(parsed.positionals.slice(1), "artifacts list");
  const options = paginationOptions(parsed.flags);
  const artifactsPage = await collectPages(options, (cursor) =>
    apiListPage<Record<string, unknown>>(
      environment,
      fetchImpl,
      `/v1/sandboxes/${sandboxId}/artifacts`,
      options,
      cursor,
    ),
  );
  return ok(
    booleanFlag(parsed.flags, "--json")
      ? jsonPageEnvelope(artifactsPage)
      : renderList(artifactsPage.data, [
          { key: "id" },
          { key: "name" },
          { key: "sizeBytes", label: "size" },
          { key: "createdAt" },
        ]),
  );
}

async function downloadArtifact(
  client: () => CrowNestClient,
  args: readonly string[],
): Promise<CliResult> {
  const parsed = parseFlags(args, {
    "--output": "string",
    ...jsonFlagSpec,
  });
  const artifactId = requiredArg(
    parsed.positionals[0],
    "artifact id",
  ) as `art_${string}`;
  const outputPath = stringFlag(parsed.flags, "--output");
  if (!outputPath) {
    throw new UsageError("output path is required. Use --output <path>.");
  }
  rejectExtraPositionals(parsed.positionals.slice(1), "artifacts download");

  const data = await client().artifacts.download(artifactId);
  await writeFileBytes(outputPath, data);
  const result = { path: outputPath };
  return ok(
    booleanFlag(parsed.flags, "--json") ? jsonEnvelope(result) : renderRecord(result),
  );
}

async function deleteArtifact(
  client: () => CrowNestClient,
  args: readonly string[],
): Promise<CliResult> {
  const parsed = parseFlags(args, jsonFlagSpec);
  const artifactId = requiredArg(
    parsed.positionals[0],
    "artifact id",
  ) as `art_${string}`;
  rejectExtraPositionals(parsed.positionals.slice(1), "artifacts delete");
  const artifact = await client().artifacts.delete(artifactId);
  const result = { ...artifact, status: "deleted" };
  return ok(
    booleanFlag(parsed.flags, "--json") ? jsonEnvelope(result) : renderRecord(result),
  );
}

function requiredSandboxId(value: string | undefined, label: string): `sbx_${string}` {
  return requiredPrefixedArg(value, label, "sbx_") as `sbx_${string}`;
}

async function executeCommand(
  args: readonly string[],
  environment: CliEnvironment,
  fetchImpl: typeof fetch | undefined,
): Promise<CliResult> {
  const sandboxId = requiredSandboxId(args[0], "sandbox id");
  const commandArgs = args.slice(1);
  const command = commandAfterSeparator(commandArgs);
  const parsedOptions = runCommandOptions(commandOptionArgs(commandArgs));
  const response = await apiPost<{ readonly command: CommandResult }>(
    environment,
    fetchImpl,
    `/v1/sandboxes/${sandboxId}/commands`,
    {
      command,
      ...(parsedOptions.options.background ? { background: true } : {}),
      ...(parsedOptions.options.collect === undefined
        ? {}
        : { collect: parsedOptions.options.collect }),
      ...(parsedOptions.options.collectOn === undefined
        ? {}
        : { collectOn: parsedOptions.options.collectOn }),
    },
  );
  const result = response.command;

  const stdout = parsedOptions.json ? jsonEnvelope(result) : renderRecord(result);
  return {
    exitCode:
      !parsedOptions.options.background &&
      result.exitCode !== undefined &&
      result.exitCode !== 0
        ? sandboxCommandExitCode(result.exitCode)
        : CLI_EXIT_OK,
    stderr: "",
    stdout,
  };
}

async function usageCommand(
  client: () => CrowNestClient,
  args: readonly string[],
): Promise<CliResult> {
  const json = parseJsonOnly(args, "usage");
  const usage = await client().usage();
  return ok(json ? jsonEnvelope(usage) : renderRecord(usage));
}

// eslint-disable-next-line complexity -- Credential introspection deliberately degrades across API-key, agent-token, and forbidden metadata responses.
async function whoamiCommand(
  args: readonly string[],
  environment: CliEnvironment,
  fetchImpl: typeof fetch | undefined,
): Promise<CliResult> {
  const json = parseJsonOnly(args, "whoami");
  const credential = configuredCredential(environment);
  if (!credential) {
    throw new Error(
      "No CrowNest credential configured. Run `crownest login --api-key <key>` or set CROWNEST_API_KEY.",
    );
  }

  const { credentialType, prefix } = credentialIdentity(credential);
  const lookup = await findApiKeyMetadata(environment, fetchImpl, prefix);
  const metadata = lookup.metadata;
  const result = {
    credentialType,
    prefix,
    name:
      metadata?.name ??
      (credentialType === "agent_token" ? "agent token" : "unavailable"),
    orgId: metadata?.orgId ?? "unavailable",
    projectIds:
      metadata?.projectIds ?? (metadata === undefined ? "unavailable" : "all"),
    scopes: metadata?.scopes ?? "unavailable",
    verified: true,
    ...(lookup.missingScope === undefined
      ? {}
      : {
          missingScopes: [lookup.missingScope],
          verificationNote:
            "Credential verified, but api_key:read is missing; key metadata is unavailable.",
        }),
  };
  return ok(json ? jsonEnvelope(result) : renderRecord(result));
}

async function findApiKeyMetadata(
  environment: CliEnvironment,
  fetchImpl: typeof fetch | undefined,
  prefix: string,
): Promise<ApiKeyMetadataLookup> {
  let cursor: string | undefined;
  const seenCursors = new Set<string>();

  for (;;) {
    const path =
      cursor === undefined
        ? "/v1/api-keys"
        : `/v1/api-keys?cursor=${encodeURIComponent(cursor)}`;
    const response = await authenticatedFetch(environment, fetchImpl, path);
    const payload = (await response.json()) as ApiKeyListPayload;
    if (response.status === 403 && payload.error?.code === "forbidden") {
      return { missingScope: "api_key:read" };
    }
    if (!response.ok) throwApiResponse(response, payload);

    const metadata = payload.data?.find((key) => key.prefix === prefix);
    if (metadata !== undefined) return { metadata };
    if (payload.hasMore !== true) return {};
    if (!payload.nextCursor || seenCursors.has(payload.nextCursor)) {
      throw new Error("Paginated response hasMore=true without a new nextCursor.");
    }
    seenCursors.add(payload.nextCursor);
    cursor = payload.nextCursor;
  }
}

function credentialIdentity(credential: string): {
  readonly credentialType: "agent_token" | "api_key";
  readonly prefix: string;
} {
  if (credential.startsWith("cn_agent_")) {
    return {
      credentialType: "agent_token",
      prefix: credential.split("_").slice(0, 3).join("_"),
    };
  }
  return { credentialType: "api_key", prefix: credential.slice(0, 18) };
}

async function apiListPage<T>(
  environment: CliEnvironment,
  fetchImpl: typeof fetch | undefined,
  path: string,
  options: ReturnType<typeof paginationOptions>,
  cursor: string | undefined,
): Promise<Page<T>> {
  const query = paginationSearchParams(options, cursor).toString();
  return await apiGet<Page<T>>(
    environment,
    fetchImpl,
    `${path}${query.length === 0 ? "" : `?${query}`}`,
  );
}

function clientOptions(
  environment: CliEnvironment,
  fetchImpl: typeof fetch | undefined,
): CrowNestClientOptions {
  const config = loadCredentialConfig(environment);
  const credential =
    environment.CROWNEST_BEARER_TOKEN ??
    environment.CROWNEST_API_KEY ??
    config.credential ??
    config.apiKey;
  const apiUrl = environment.CROWNEST_API_URL ?? config.apiUrl;

  return {
    ...(credential === undefined ? {} : { credential }),
    ...(apiUrl === undefined ? {} : { baseUrl: apiUrl }),
    ...(fetchImpl === undefined ? {} : { fetch: fetchImpl }),
  };
}

function positiveIntegerFlag(
  flags: Record<string, string | boolean | readonly string[]>,
  flag: string,
): number {
  const value = stringFlag(flags, flag);
  if (value === undefined) {
    throw new UsageError(`${flag} is required.`);
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new UsageError(`${flag} must be a positive integer.`);
  }

  return parsed;
}

function commandAfterSeparator(args: readonly string[]): string {
  const separatorIndex = args.indexOf("--");
  if (separatorIndex < 0) {
    throw new UsageError("command separator is required. Use -- before the command.");
  }

  const commandParts = args.slice(separatorIndex + 1);
  if (commandParts.length === 0) {
    throw new UsageError("command is required.");
  }

  return commandParts.map(shellEscapeArg).join(" ");
}

function runCommandOptions(args: readonly string[]): {
  readonly json: boolean;
  readonly options: CommandRunOptions;
} {
  const parsed = parseFlags(args, {
    "--background": "boolean",
    "--collect": "string[]",
    "--collect-on": "string",
    ...jsonFlagSpec,
  });
  rejectExtraPositionals(parsed.positionals, "commands run");
  const collect = stringArrayFlag(parsed.flags, "--collect").map((path) => ({
    path,
  }));
  const collectOn = stringFlag(parsed.flags, "--collect-on");
  if (collectOn !== undefined && collectOn !== "success" && collectOn !== "always") {
    throw new UsageError("collect-on must be success or always.");
  }
  const background = booleanFlag(parsed.flags, "--background");
  if (background && collect.length > 0) {
    throw new UsageError("--background cannot be used with --collect.");
  }
  if (background && collectOn !== undefined) {
    throw new UsageError("--background cannot be used with --collect-on.");
  }

  return {
    json: booleanFlag(parsed.flags, "--json"),
    options: {
      background,
      ...(collect.length === 0 ? {} : { collect }),
      ...(collectOn === undefined ? {} : { collectOn }),
    },
  };
}

function commandOptionArgs(args: readonly string[]): readonly string[] {
  const separatorIndex = args.indexOf("--");
  return separatorIndex < 0 ? [] : args.slice(0, separatorIndex);
}

function parseJsonOnly(args: readonly string[], command: string): boolean {
  const parsed = parseFlags(args, jsonFlagSpec);
  rejectExtraPositionals(parsed.positionals, command);
  return booleanFlag(parsed.flags, "--json");
}

function shellEscapeArg(arg: string): string {
  if (/^[A-Za-z0-9_./:=@%+-]+$/.test(arg)) {
    return arg;
  }

  return `'${arg.replaceAll("'", "'\"'\"'")}'`;
}

function compact(values: readonly (string | undefined)[]): readonly string[] {
  return values.filter((value): value is string => value !== undefined);
}

function ok(stdout: string): CliResult {
  return { exitCode: CLI_EXIT_OK, stderr: "", stdout };
}

function fail(stderr: string, exitCode: number): CliResult {
  return { exitCode, stderr, stdout: "" };
}

function failError(
  error: {
    readonly code: string;
    readonly details?: Readonly<Record<string, unknown>> | null;
    readonly message: string;
    readonly retryable?: boolean;
    readonly status?: number | null;
  },
  exitCode: number,
  wantsJson: boolean,
): CliResult {
  return fail(wantsJson ? jsonErrorEnvelope(error) : `${error.message}\n`, exitCode);
}

function failApiError(error: CrowNestApiError, wantsJson: boolean): CliResult {
  if (!wantsJson) return fail(renderApiError(error), CLI_EXIT_API_ERROR);

  return fail(
    jsonErrorEnvelope({
      code: error.code,
      details: error.details ?? null,
      message: error.message,
      retryable: retryableApiError(error),
      status: error.status,
    }),
    CLI_EXIT_API_ERROR,
  );
}

function normalizeCliResult(result: CliResult, wantsJson: boolean): CliResult {
  if (!wantsJson || result.exitCode === CLI_EXIT_OK || isJsonObject(result.stderr)) {
    return result;
  }

  return {
    ...result,
    stderr: jsonErrorEnvelope({
      code: result.exitCode === CLI_EXIT_USAGE_ERROR ? "usage_error" : "runtime_error",
      message: result.stderr.trim(),
    }),
  };
}

function renderApiError(error: CrowNestApiError): string {
  const lines = [`error[${error.code}]: ${error.message}`, `status: ${error.status}`];
  if (error.details !== undefined) {
    lines.push("details:");
    lines.push(
      JSON.stringify(error.details, null, 2)
        .split("\n")
        .map((line) => `  ${line}`)
        .join("\n"),
    );
  }

  return `${lines.join("\n")}\n`;
}

function wantsJsonOutput(argv: readonly string[]): boolean {
  const separatorIndex = argv.indexOf("--");
  const optionArgs = separatorIndex < 0 ? argv : argv.slice(0, separatorIndex);
  return optionArgs.includes("--json");
}

function retryableApiError(error: CrowNestApiError): boolean {
  return error.status === 429 || error.status >= 500 || error.code === "rate_limited";
}

function isJsonObject(value: string): boolean {
  try {
    return typeof JSON.parse(value) === "object";
  } catch {
    return false;
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const rawStdin = isFilesWriteStdin(argv);
  if (rawStdin) process.stdin.setEncoding("utf8");
  const rl = rawStdin ? undefined : createInterface({ input: process.stdin });
  const result = await runCli(
    argv,
    process.env,
    undefined,
    {
      stderr: process.stderr,
      stdout: process.stdout,
    },
    rawStdin ? (process.stdin as AsyncIterable<string>) : rl,
  ).finally(() => {
    rl?.close();
  });

  if (result.stdout.length > 0) process.stdout.write(result.stdout);
  if (result.stderr.length > 0) process.stderr.write(result.stderr);

  process.exitCode = result.exitCode;
}

function isFilesWriteStdin(argv: readonly string[]): boolean {
  if (argv[0] !== "files" || argv[1] !== "write") return false;
  const fileFlagIndex = argv.findIndex(
    (value) => value === "--file" || value.startsWith("--file="),
  );
  return fileFlagIndex < 0 && argv.includes("-");
}

const currentModulePath = fileURLToPath(import.meta.url);

function isMainModule(entrypoint: string | undefined): boolean {
  try {
    return (
      entrypoint !== undefined &&
      realpathSync(entrypoint) === realpathSync(currentModulePath)
    );
  } catch {
    return false;
  }
}

if (isMainModule(process.argv[1])) void main();

/* eslint-enable max-lines -- End CLI router file. */
