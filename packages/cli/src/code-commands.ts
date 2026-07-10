import { readFile } from "node:fs/promises";

import type { CodeArtifactPolicy, CodeLanguage, CrowNestClient } from "@crownest/sdk";

import {
  type CodeExecutionError,
  renderCodeOutput,
  renderExecutionError,
  writeChunk,
  writeCodeOutputs,
} from "./code-rendering";
import { CLI_EXIT_API_ERROR, CLI_EXIT_OK, CLI_EXIT_USAGE_ERROR } from "./exit-codes";
import {
  jsonFlagSpec,
  parseFlags,
  rejectExtraPositionals,
  requiredArg,
  stringFlag,
  UsageError,
} from "./flags";
import type { CliOutput, CliResult } from "./index";

export async function codeRunCommand(
  client: () => CrowNestClient,
  args: readonly string[],
  output?: CliOutput,
): Promise<CliResult> {
  try {
    return await codeRunCommandInner(client, args, output);
  } catch (error) {
    if (error instanceof UsageError) {
      return fail(`${error.message}\n`, CLI_EXIT_USAGE_ERROR);
    }
    throw error;
  }
}

async function codeRunCommandInner(
  client: () => CrowNestClient,
  args: readonly string[],
  output?: CliOutput,
): Promise<CliResult> {
  const parsed = parseFlags(args, {
    "--artifact-policy": "string",
    "--code": "string",
    "--context": "string",
    "--cwd": "string",
    "--file": "string",
    "--idempotency-key": "string",
    "--language": "string",
    "--timeout-ms": "string",
    ...jsonFlagSpec,
  });
  const sandboxId = sandboxIdArg(parsed.positionals[0]);
  rejectExtraPositionals(parsed.positionals.slice(1), "code run");
  const codeValue = stringFlag(parsed.flags, "--code");
  const fileValue = stringFlag(parsed.flags, "--file");

  if (
    (codeValue === undefined && fileValue === undefined) ||
    (codeValue !== undefined && fileValue !== undefined)
  ) {
    return fail(
      "Use exactly one of --code <source> or --file <path>.\n",
      CLI_EXIT_USAGE_ERROR,
    );
  }

  const language = languageOption(stringFlag(parsed.flags, "--language"));
  const artifactPolicy = artifactPolicyOption(
    stringFlag(parsed.flags, "--artifact-policy"),
  );
  const timeoutMs = optionalPositiveIntegerOption(
    stringFlag(parsed.flags, "--timeout-ms"),
    "--timeout-ms",
  );
  const contextId = stringFlag(parsed.flags, "--context") as
    | `cctx_${string}`
    | undefined;
  const cwd = stringFlag(parsed.flags, "--cwd");
  const idempotencyKey = stringFlag(parsed.flags, "--idempotency-key");
  const code = codeValue ?? (await readFile(requiredArg(fileValue, "file"), "utf8"));
  return collectCodeRunStream(
    client().code.runStream(sandboxId, {
      code,
      ...(artifactPolicy === undefined ? {} : { artifactPolicy }),
      ...(contextId === undefined ? {} : { contextId }),
      ...(cwd === undefined ? {} : { cwd }),
      ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
      language,
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    }),
    output,
  );
}

type ExecutionErrorState = {
  readonly rendered: boolean;
};

type CodeRunStream = ReturnType<CrowNestClient["code"]["runStream"]>;

// eslint-disable-next-line complexity -- CodeRun stream rendering dispatches the full event union and final exit-state rules.
async function collectCodeRunStream(
  events: CodeRunStream,
  output?: CliOutput,
): Promise<CliResult> {
  let stdout = "";
  let stderr = "";
  let executionError: ExecutionErrorState | undefined;
  let completed = false;
  let streamedOutput = false;
  let streamedStderr = false;
  let streamedStdout = false;

  for await (const event of events) {
    switch (event.type) {
      case "stdout":
        streamedStdout = true;
        stdout += writeChunk(output?.stdout, event.data);
        break;
      case "stderr":
        streamedStderr = true;
        stderr += writeChunk(output?.stderr, event.data);
        break;
      case "output":
        streamedOutput = true;
        stdout += writeChunk(output?.stdout, renderCodeOutput(event.data));
        break;
      case "error": {
        const rendered = renderExecutionErrorEvent(event.data, executionError);
        executionError = rendered.state;
        stderr += writeChunk(output?.stderr, rendered.stderr);
        break;
      }
      case "complete":
        completed = true;
        if (!streamedStdout) {
          stdout += writeChunk(output?.stdout, event.data.stdout);
        }
        if (!streamedStderr) {
          stderr += writeChunk(output?.stderr, event.data.stderr);
        }
        if (!streamedOutput) {
          stdout += writeCodeOutputs(output?.stdout, event.data.outputs);
        }
        if (event.data.error !== undefined) {
          const rendered = renderExecutionErrorEvent(event.data.error, executionError);
          executionError = rendered.state;
          stderr += writeChunk(output?.stderr, rendered.stderr);
        }
        break;
    }
  }

  if (executionError !== undefined) {
    return codeRunResult(CLI_EXIT_API_ERROR, stdout, stderr, output);
  }

  if (!completed) {
    stderr += writeChunk(
      output?.stderr,
      "Error: code run stream ended before a complete event.\n",
    );
    return codeRunResult(CLI_EXIT_API_ERROR, stdout, stderr, output);
  }

  return codeRunResult(CLI_EXIT_OK, stdout, stderr, output);
}

function codeRunResult(
  exitCode: number,
  stdout: string,
  stderr: string,
  output?: CliOutput,
): CliResult {
  return { exitCode, stderr: output ? "" : stderr, stdout: output ? "" : stdout };
}

function renderExecutionErrorEvent(
  error: CodeExecutionError,
  current: ExecutionErrorState | undefined,
): { readonly state: ExecutionErrorState; readonly stderr: string } {
  if (current?.rendered) {
    return {
      state: { rendered: true },
      stderr: "",
    };
  }

  return {
    state: { rendered: true },
    stderr: renderExecutionError(error),
  };
}

function languageOption(value: string | undefined): CodeLanguage {
  if (value === undefined) return "python";
  if (value === "python" || value === "javascript" || value === "typescript") {
    return value;
  }
  throw new UsageError("--language must be python, javascript, or typescript.");
}

function artifactPolicyOption(
  value: string | undefined,
): CodeArtifactPolicy | undefined {
  if (value === undefined) return undefined;
  if (value === "inline_only" || value === "promote") return value;
  throw new UsageError("--artifact-policy must be inline_only or promote.");
}

function optionalPositiveIntegerOption(
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

function sandboxIdArg(value: string | undefined): `sbx_${string}` {
  if (value === undefined || value.startsWith("--")) {
    throw new UsageError("sandbox id is required.");
  }
  if (!value.startsWith("sbx_")) {
    throw new UsageError("sandbox id must start with sbx_.");
  }
  return value as `sbx_${string}`;
}

function fail(stderr: string, exitCode: number): CliResult {
  return { exitCode, stderr, stdout: "" };
}
