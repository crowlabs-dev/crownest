import type { CodeLanguage, CrowNestClient } from "@crownest/sdk";

import { apiPost } from "./api-request";
import {
  type CodeExecutionError,
  renderCodeOutput,
  renderExecutionError,
  writeChunk,
} from "./code-rendering";
import { CLI_EXIT_OK } from "./exit-codes";
import {
  booleanFlag,
  parseFlags,
  rejectExtraPositionals,
  requiredPrefixedArg,
  stringFlag,
  UsageError,
} from "./flags";
import type { CliEnvironment, CliInput, CliOutput, CliResult } from "./index";

type ShellCommandOptions = {
  readonly environment: CliEnvironment;
  readonly fetchImpl?: typeof fetch | undefined;
};

type BashCommandResult = {
  readonly exitCode?: number;
  readonly stderr?: string;
  readonly stdout?: string;
};

type ShellWriter = {
  readonly result: () => CliResult;
  readonly stderr: (chunk: string) => void;
  readonly stdout: (chunk: string) => void;
};

type CodeRunStream = ReturnType<CrowNestClient["code"]["runStream"]>;
type CodeRunEvent = CodeRunStream extends AsyncIterable<infer Event> ? Event : never;
type CompleteCodeRunEvent = Extract<CodeRunEvent, { readonly type: "complete" }>;

type CodeRunState = {
  completed: boolean;
  errorRendered: boolean;
  streamedOutput: boolean;
  streamedStderr: boolean;
  streamedStdout: boolean;
};

export async function shellCommand(
  client: () => CrowNestClient,
  args: readonly string[],
  input: CliInput | undefined,
  output?: CliOutput,
  options?: ShellCommandOptions,
): Promise<CliResult> {
  const parsed = parseFlags(args, {
    "--bash": "boolean",
    "--lang": "string",
  });
  const sandboxId = requiredPrefixedArg(
    parsed.positionals[0],
    "sandbox id",
    "sbx_",
  ) as `sbx_${string}`;
  rejectExtraPositionals(parsed.positionals.slice(1), "shell");

  if (booleanFlag(parsed.flags, "--bash")) {
    if (stringFlag(parsed.flags, "--lang") !== undefined) {
      throw new UsageError("--lang cannot be used with --bash.");
    }
    if (options === undefined) {
      throw new Error("CLI environment is required for bash shell commands.");
    }
    return await bashShell(sandboxId, input, output, options);
  }

  return await codeShell(
    client,
    sandboxId,
    languageOption(stringFlag(parsed.flags, "--lang")),
    input,
    output,
  );
}

async function codeShell(
  client: () => CrowNestClient,
  sandboxId: `sbx_${string}`,
  language: CodeLanguage,
  input: CliInput | undefined,
  output?: CliOutput,
): Promise<CliResult> {
  const writer = createShellWriter(output);
  const context = await client().code.createContext(sandboxId, { language });

  writer.stdout(
    `crownest shell - ${language} - ${sandboxId} - variables persist - Ctrl-D to exit\n`,
  );
  writer.stdout(">>> ");

  try {
    for await (const rawLine of inputLines(input)) {
      const line = stripLineEnding(rawLine);
      if (isExitLine(line)) break;
      if (line.trim().length > 0) {
        await renderCodeRun(
          client().code.runStream(sandboxId, {
            code: line,
            contextId: context.id,
            language,
          }),
          writer,
        );
      }
      writer.stdout(">>> ");
    }
  } finally {
    await client()
      .code.deleteContext(sandboxId, context.id)
      .catch(() => undefined);
  }

  return writer.result();
}

async function bashShell(
  sandboxId: `sbx_${string}`,
  input: CliInput | undefined,
  output: CliOutput | undefined,
  options: ShellCommandOptions,
): Promise<CliResult> {
  const writer = createShellWriter(output);

  writer.stdout(
    `crownest shell - bash - ${sandboxId} - each line runs independently; cwd, env, and shell vars do not persist - Ctrl-D to exit\n`,
  );
  writer.stdout("$ ");

  for await (const rawLine of inputLines(input)) {
    const line = stripLineEnding(rawLine);
    if (isExitLine(line)) break;
    if (line.trim().length > 0) {
      const response = await apiPost<{ readonly command: BashCommandResult }>(
        options.environment,
        options.fetchImpl,
        `/v1/sandboxes/${sandboxId}/commands`,
        { command: line },
      );
      const command = response.command;
      if (command.stdout) writer.stdout(command.stdout);
      if (command.stderr) writer.stderr(command.stderr);
      if (command.exitCode !== undefined && command.exitCode !== 0) {
        writer.stderr(`[exit ${command.exitCode}]\n`);
      }
    }
    writer.stdout("$ ");
  }

  return writer.result();
}

async function renderCodeRun(events: CodeRunStream, writer: ShellWriter) {
  const state: CodeRunState = {
    completed: false,
    errorRendered: false,
    streamedOutput: false,
    streamedStderr: false,
    streamedStdout: false,
  };

  for await (const event of events) {
    renderCodeRunEvent(event, state, writer);
  }

  if (!state.completed) {
    throw new Error("code run stream ended before a complete event.");
  }
}

function renderCodeRunEvent(
  event: CodeRunEvent,
  state: CodeRunState,
  writer: ShellWriter,
) {
  switch (event.type) {
    case "stdout":
      state.streamedStdout = true;
      writer.stdout(event.data);
      break;
    case "stderr":
      state.streamedStderr = true;
      writer.stderr(event.data);
      break;
    case "output":
      state.streamedOutput = true;
      writer.stdout(renderCodeOutput(event.data));
      break;
    case "error":
      state.errorRendered = writeExecutionError(
        event.data,
        writer,
        state.errorRendered,
      );
      break;
    case "complete":
      renderCompleteCodeRun(event, state, writer);
      break;
  }
}

function renderCompleteCodeRun(
  event: CompleteCodeRunEvent,
  state: CodeRunState,
  writer: ShellWriter,
) {
  state.completed = true;
  if (!state.streamedStdout) {
    for (const chunk of event.data.stdout) writer.stdout(chunk);
  }
  if (!state.streamedStderr) {
    for (const chunk of event.data.stderr) writer.stderr(chunk);
  }
  if (!state.streamedOutput) {
    for (const codeOutput of event.data.outputs) {
      writer.stdout(renderCodeOutput(codeOutput));
    }
  }
  if (event.data.error !== undefined) {
    state.errorRendered = writeExecutionError(
      event.data.error,
      writer,
      state.errorRendered,
    );
  }
}

function writeExecutionError(
  error: CodeExecutionError,
  writer: ShellWriter,
  alreadyRendered: boolean,
) {
  if (!alreadyRendered) writer.stderr(renderExecutionError(error));
  return true;
}

function createShellWriter(output?: CliOutput): ShellWriter {
  let stdout = "";
  let stderr = "";

  return {
    result: () => ({
      exitCode: CLI_EXIT_OK,
      stderr: output ? "" : stderr,
      stdout: output ? "" : stdout,
    }),
    stderr: (chunk) => {
      stderr += writeChunk(output?.stderr, chunk);
    },
    stdout: (chunk) => {
      stdout += writeChunk(output?.stdout, chunk);
    },
  };
}

function inputLines(input: CliInput | undefined): CliInput {
  return input ?? [];
}

function stripLineEnding(line: string) {
  return line.replace(/\r?\n$/, "");
}

function isExitLine(line: string) {
  return line.trim() === "exit" || line.trim() === "quit";
}

function languageOption(value: string | undefined): CodeLanguage {
  if (value === undefined) return "python";
  if (value === "python" || value === "javascript" || value === "typescript") {
    return value;
  }
  throw new UsageError("--lang must be python, javascript, or typescript.");
}
