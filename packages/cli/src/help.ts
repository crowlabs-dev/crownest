/* eslint-disable max-lines -- Canonical help text lists every CLI command. */

import { CLI_EXIT_API_ERROR, CLI_EXIT_OK, CLI_EXIT_USAGE_ERROR } from "./exit-codes";
import type { CanonicalCliCommand } from "./index";

type CommandHelp = {
  readonly flags?: readonly {
    readonly flag: string;
    readonly description: string;
  }[];
  readonly summary: string;
  readonly usage: string;
};

const jsonFlag = {
  flag: "--json",
  description: 'Print a stable JSON envelope: {"data": ...}.',
} as const;

const streamingJsonFlag = {
  flag: "--json",
  description: "Accepted for consistency; streamed output remains raw.",
} as const;

const streamEventsJsonFlag = {
  flag: "--json",
  description: "Print each streamed event as a JSON envelope.",
} as const;

const paginationFlags = [
  { flag: "--limit", description: "Page size from 1 to 500." },
  { flag: "--cursor", description: "Resume from an opaque pagination cursor." },
  { flag: "--all", description: "Fetch every remaining page." },
] as const;

export const cliCommandHelp = {
  login: {
    summary: "Save API credentials or print login guidance.",
    usage: "crownest login [--api-key <key>] [--api-url <url>] [--json]",
    flags: [
      { flag: "--api-key", description: "API key to save." },
      { flag: "--api-url", description: "API base URL." },
      jsonFlag,
    ],
  },
  usage: {
    summary: "Print current credits, compute usage, and quota buckets.",
    usage: "crownest usage [--json]",
    flags: [jsonFlag],
  },
  whoami: {
    summary:
      "Verify the configured credential and report metadata or missing api_key:read scope.",
    usage: "crownest whoami [--json]",
    flags: [jsonFlag],
  },
  "projects list": {
    summary: "List projects available to the configured API key.",
    usage: "crownest projects list [--limit <n>] [--cursor <cursor>] [--all] [--json]",
    flags: [...paginationFlags, jsonFlag],
  },
  "keys create": {
    summary: "Create an API key from a human dashboard session.",
    usage:
      "crownest keys create [--name <name>] [--project <prj_id>] [--scope <scope>]... [--api-url <url>] [--json]",
    flags: [
      { flag: "--name", description: "API key display name." },
      { flag: "--project", description: "Restrict the key to one project." },
      { flag: "--scope", description: "Scope to grant. Repeatable." },
      { flag: "--api-url", description: "API base URL for key management." },
      jsonFlag,
    ],
  },
  "keys list": {
    summary: "List API keys from a human dashboard session.",
    usage:
      "crownest keys list [--api-url <url>] [--limit <n>] [--cursor <cursor>] [--all] [--json]",
    flags: [
      { flag: "--api-url", description: "API base URL for key management." },
      ...paginationFlags,
      jsonFlag,
    ],
  },
  "sandboxes create": {
    summary: "Create a sandbox.",
    usage:
      "crownest sandboxes create [--project <prj_id>] [--template <slug>] [--json]",
    flags: [
      { flag: "--project", description: "Project to create the sandbox in." },
      { flag: "--template", description: "Template slug such as python or node." },
      jsonFlag,
    ],
  },
  "sandboxes set-ttl": {
    summary: "Reset the sandbox TTL countdown from now.",
    usage: "crownest sandboxes set-ttl <sandbox-id> --ttl-ms <ms> [--json]",
    flags: [
      { flag: "--ttl-ms", description: "New sandbox lifetime in milliseconds." },
      jsonFlag,
    ],
  },
  "sandboxes list": {
    summary: "List live sandboxes.",
    usage: "crownest sandboxes list [--limit <n>] [--cursor <cursor>] [--all] [--json]",
    flags: [...paginationFlags, jsonFlag],
  },
  "sandboxes get": {
    summary: "Print one sandbox.",
    usage: "crownest sandboxes get <sandbox-id> [--json]",
    flags: [jsonFlag],
  },
  "sandboxes kill": {
    summary: "Destroy a sandbox.",
    usage: "crownest sandboxes kill <sandbox-id> [--json]",
    flags: [jsonFlag],
  },
  "commands run": {
    summary: "Run a command in the foreground or start it in the background.",
    usage:
      "crownest commands run <sandbox-id> [--background] [--collect <path>]... [--collect-on success|always] [--json] -- <command>",
    flags: [
      {
        flag: "--background",
        description:
          "Return immediately; incompatible with --collect and --collect-on.",
      },
      {
        flag: "--collect",
        description: "Workspace path to export as an artifact. Repeatable.",
      },
      { flag: "--collect-on", description: "Collect on success or always." },
      jsonFlag,
    ],
  },
  "commands get": {
    summary: "Print one command and its captured output.",
    usage: "crownest commands get <command-id> [--json]",
    flags: [jsonFlag],
  },
  "commands cancel": {
    summary: "Cancel a running command.",
    usage: "crownest commands cancel <command-id> [--force] [--json]",
    flags: [
      {
        flag: "--force",
        description: "Use forceful cancellation instead of graceful cancellation.",
      },
      jsonFlag,
    ],
  },
  logs: {
    summary: "Stream command logs until the command reaches a terminal state.",
    usage:
      "crownest logs <command-id> [--json]\ncrownest logs <sandbox-id> --command <command-id> [--json]",
    flags: [
      {
        flag: "--command",
        description: "Command ID when the first argument is a sandbox ID.",
      },
      streamingJsonFlag,
    ],
  },
  shell: {
    summary: "Open a line-oriented sandbox shell.",
    usage: "crownest shell <sandbox-id> [--lang python|javascript|typescript] [--bash]",
    flags: [
      {
        flag: "--lang",
        description: "Code shell language: python, javascript, or typescript.",
      },
      {
        flag: "--bash",
        description: "Run each line as an independent shell command.",
      },
    ],
  },
  "skills install": {
    summary: "Install the bundled CrowNest Agent Skill.",
    usage:
      "crownest skills install [--scope user|project] [--force] [--dry-run] [--json]",
    flags: [
      {
        flag: "--scope",
        description: "Install location: user or project. Defaults to user.",
      },
      { flag: "--force", description: "Replace an existing installed skill." },
      { flag: "--dry-run", description: "Print the destination without writing." },
      jsonFlag,
    ],
  },
  "code run": {
    summary: "Run interpreter code in a sandbox.",
    usage:
      "crownest code run <sandbox-id> (--code <source> | --file <path>) [--language python|javascript|typescript] [--artifact-policy inline_only|promote] [--timeout-ms <ms>] [--context <cctx_id>] [--cwd <path>] [--idempotency-key <key>] [--json]",
    flags: [
      { flag: "--code", description: "Inline source code to run." },
      { flag: "--file", description: "Local source file to run." },
      {
        flag: "--language",
        description: "Language: python, javascript, or typescript.",
      },
      {
        flag: "--artifact-policy",
        description: "Artifact handling: inline_only or promote.",
      },
      { flag: "--timeout-ms", description: "Execution timeout in milliseconds." },
      { flag: "--context", description: "Existing Code Context ID." },
      { flag: "--cwd", description: "Working directory inside the sandbox." },
      {
        flag: "--idempotency-key",
        description: "Idempotency key for retry-safe requests.",
      },
      streamingJsonFlag,
    ],
  },
  "files read": {
    summary: "Print a workspace file's content.",
    usage: "crownest files read <sandbox-id> <path> [--json]",
    flags: [jsonFlag],
  },
  "files write": {
    summary: "Write content to a workspace file.",
    usage:
      "crownest files write <sandbox-id> <path> (<content> | - | --file <local-path>) [--create-parents] [--json]",
    flags: [
      { flag: "--file", description: "Read content from a local text file." },
      { flag: "--create-parents", description: "Create missing parent directories." },
      jsonFlag,
    ],
  },
  "files upload": {
    summary: "Upload a local file into the workspace.",
    usage:
      "crownest files upload <sandbox-id> <local-path> [<remote-path>] [--to <remote-path>] [--create-parents] [--json]",
    flags: [
      { flag: "--to", description: "Destination workspace path." },
      { flag: "--create-parents", description: "Create missing parent directories." },
      jsonFlag,
    ],
  },
  "files download": {
    summary: "Download a workspace file with binary-safe transfer.",
    usage:
      "crownest files download <sandbox-id> <remote-path> [<local-path> | --output <path>] [--json]",
    flags: [
      {
        flag: "--output",
        description: "Local output path; defaults to remote basename.",
      },
      jsonFlag,
    ],
  },
  "files list": {
    summary: "List workspace directory entries.",
    usage: "crownest files list <sandbox-id> [path] [--json]",
    flags: [jsonFlag],
  },
  "files stat": {
    summary: "Print workspace file metadata.",
    usage: "crownest files stat <sandbox-id> <path> [--json]",
    flags: [jsonFlag],
  },
  "files mkdir": {
    summary: "Create a workspace directory.",
    usage: "crownest files mkdir <sandbox-id> <path> [--parents] [--json]",
    flags: [
      { flag: "--parents", description: "Create intermediate directories." },
      jsonFlag,
    ],
  },
  "files move": {
    summary: "Move or rename a workspace file or directory.",
    usage: "crownest files move <sandbox-id> <from> <to> [--overwrite] [--json]",
    flags: [
      { flag: "--overwrite", description: "Replace an existing destination." },
      jsonFlag,
    ],
  },
  "files delete": {
    summary: "Delete a workspace file or empty directory.",
    usage: "crownest files delete <sandbox-id> <path> [--json]",
    flags: [jsonFlag],
  },
  "artifacts create": {
    summary: "Export a workspace file as an artifact.",
    usage: "crownest artifacts create <sandbox-id> <path> [--name <name>] [--json]",
    flags: [{ flag: "--name", description: "Artifact display name." }, jsonFlag],
  },
  "artifacts list": {
    summary: "List artifacts exported from a sandbox.",
    usage:
      "crownest artifacts list <sandbox-id> [--limit <n>] [--cursor <cursor>] [--all] [--json]",
    flags: [...paginationFlags, jsonFlag],
  },
  "artifacts download": {
    summary: "Download an artifact to a local file.",
    usage: "crownest artifacts download <artifact-id> --output <path> [--json]",
    flags: [{ flag: "--output", description: "Local output path." }, jsonFlag],
  },
  "artifacts delete": {
    summary: "Delete an artifact.",
    usage: "crownest artifacts delete <artifact-id> [--json]",
    flags: [jsonFlag],
  },
  "previews create": {
    summary: "Expose a sandbox port as an authenticated preview.",
    usage:
      "crownest previews create <sandbox-id> --port <port> [--auth-mode authenticated|token] [--json]",
    flags: [
      { flag: "--port", description: "Sandbox port from 1 to 65535." },
      {
        flag: "--auth-mode",
        description: "Preview auth mode: authenticated or token. Alias: --auth.",
      },
      jsonFlag,
    ],
  },
  "previews list": {
    summary: "List previews for a sandbox.",
    usage:
      "crownest previews list <sandbox-id> [--limit <n>] [--cursor <cursor>] [--all] [--json]",
    flags: [...paginationFlags, jsonFlag],
  },
  "previews revoke": {
    summary: "Revoke a preview.",
    usage: "crownest previews revoke <preview-id> [--json]",
    flags: [jsonFlag],
  },
  "workspace-runs create": {
    summary: "Create a Workspace Run record.",
    usage:
      "crownest workspace-runs create --command <command> [--project <prj_id>] [--template <slug>] [--sandbox <sbx_id>] [--keep-sandbox] [--timeout-ms <ms>] [--metadata key=value]... [--json]",
    flags: [
      { flag: "--command", description: "Shell command to run after archive upload." },
      { flag: "--project", description: "Project to create the run in." },
      { flag: "--template", description: "Template slug such as python-node." },
      { flag: "--sandbox", description: "Warm sandbox to reuse." },
      { flag: "--keep-sandbox", description: "Keep the sandbox after the run." },
      { flag: "--timeout-ms", description: "Command timeout in milliseconds." },
      { flag: "--metadata", description: "Metadata label as key=value. Repeatable." },
      jsonFlag,
    ],
  },
  "workspace-runs upload": {
    summary: "Upload an existing gzipped tar archive to a Workspace Run.",
    usage:
      "crownest workspace-runs upload <workspace-run-id> <archive.tgz> [--sha256 <hex>] [--json]",
    flags: [{ flag: "--sha256", description: "Expected SHA-256 checksum." }, jsonFlag],
  },
  "workspace-runs start": {
    summary: "Start extraction and command execution for an uploaded Workspace Run.",
    usage: "crownest workspace-runs start <workspace-run-id> [--json]",
    flags: [jsonFlag],
  },
  "workspace-runs run-archive": {
    summary: "Upload an existing archive, start the run, and stream output.",
    usage:
      "crownest workspace-runs run-archive <archive.tgz> [--project <prj_id>] [--template <slug>] [--sandbox <sbx_id>] [--keep-sandbox] [--timeout-ms <ms>] [--metadata key=value]... [--json] -- <command>",
    flags: [
      { flag: "--project", description: "Project to create the run in." },
      { flag: "--template", description: "Template slug such as python-node." },
      { flag: "--sandbox", description: "Warm sandbox to reuse." },
      { flag: "--keep-sandbox", description: "Keep the sandbox after the run." },
      { flag: "--timeout-ms", description: "Command timeout in milliseconds." },
      { flag: "--metadata", description: "Metadata label as key=value. Repeatable." },
      streamEventsJsonFlag,
    ],
  },
  "workspace-runs status": {
    summary: "Retrieve Workspace Run status.",
    usage: "crownest workspace-runs status <workspace-run-id> [--json]",
    flags: [jsonFlag],
  },
  "workspace-runs list": {
    summary: "List Workspace Runs.",
    usage:
      "crownest workspace-runs list [--project <prj_id>] [--status <status>] [--limit <n>] [--cursor <cursor>] [--all] [--json]",
    flags: [
      { flag: "--project", description: "Filter by project." },
      { flag: "--status", description: "Filter by Workspace Run status." },
      ...paginationFlags,
      jsonFlag,
    ],
  },
  "workspace-runs logs": {
    summary: "Stream Workspace Run events.",
    usage: "crownest workspace-runs logs <workspace-run-id> [--after-seq <n>] [--json]",
    flags: [
      { flag: "--after-seq", description: "Resume after an event sequence." },
      streamEventsJsonFlag,
    ],
  },
  "workspace-runs cancel": {
    summary: "Cancel an active Workspace Run.",
    usage: "crownest workspace-runs cancel <workspace-run-id> [--json]",
    flags: [jsonFlag],
  },
  "workspace-runs evidence": {
    summary: "Read durable Workspace Run evidence.",
    usage:
      "crownest workspace-runs evidence <workspace-run-id> [--output <path>] [--json]",
    flags: [
      { flag: "--output", description: "Write evidence JSON to a local path." },
      jsonFlag,
    ],
  },
} as const satisfies Record<CanonicalCliCommand, CommandHelp>;

export function helpOutput(argv: readonly string[]): string | undefined {
  if (argv.length === 0 || isHelpToken(argv[0])) {
    return renderGlobalHelp();
  }

  if (argv[0] === "help") {
    const command = argv.slice(1).join(" ");
    return command.length === 0 ? renderGlobalHelp() : renderCommandHelp(command);
  }

  if (argv.some(isHelpToken)) {
    const command = argv.filter((arg) => !isHelpToken(arg)).join(" ");
    return command.length === 0 ? renderGlobalHelp() : renderCommandHelp(command);
  }

  return undefined;
}

export function renderGlobalHelp(): string {
  const commands = Object.entries(cliCommandHelp);
  const width = Math.max(...commands.map(([command]) => command.length));
  const lines = commands.map(
    ([command, help]) => `  ${command.padEnd(width)}  ${help.summary}`,
  );

  return [
    "CrowNest CLI",
    "",
    "Usage:",
    "  crownest <command> [options]",
    "  crownest help <command>",
    "  crownest --version",
    "",
    "Commands:",
    ...lines,
    "",
    "Run `crownest help <command>` for command-specific flags.",
    ...exitCodeHelp(),
    "Docs: https://crownest.dev/docs",
    "",
  ].join("\n");
}

export function renderCommandHelp(command: string): string | undefined {
  if (!Object.hasOwn(cliCommandHelp, command)) return undefined;

  const help = cliCommandHelp[command as CanonicalCliCommand];
  const flagLines = help.flags.map(
    ({ flag, description }) => `  ${flag.padEnd(18)} ${description}`,
  );

  return [
    `crownest ${command}`,
    "",
    help.summary,
    "",
    "Usage:",
    `  ${help.usage}`,
    ...(flagLines.length === 0 ? [] : ["", "Flags:", ...flagLines]),
    ...exitCodeHelp(),
    "",
  ].join("\n");
}

function exitCodeHelp(): readonly string[] {
  return [
    "",
    "Exit codes:",
    `  ${CLI_EXIT_OK}  success`,
    `  ${CLI_EXIT_API_ERROR}  API or runtime error`,
    `  ${CLI_EXIT_USAGE_ERROR}  usage error (invalid command, flags, or arguments)`,
    "  foreground commands run returns the sandbox command exit code (maximum 125)",
    "  background commands run exits 0 after a successful start",
    "  sandbox exit codes 1 and 2 overlap CLI errors; --json distinguishes result envelopes",
  ];
}

function isHelpToken(value: string | undefined): boolean {
  return value === "--help" || value === "-h";
}

/* eslint-enable max-lines -- End canonical CLI help table. */
