import { tool } from "ai";
import { z } from "zod/v4";

import { CrownestToolSession, type CrownestToolsOptions } from "./session";

export const MAX_READ_FILE_BYTES = 64_000;

const sessions = new WeakMap<CrownestToolSet, CrownestToolSession>();

const codeLanguageSchema = z.enum(["python", "javascript", "typescript"]);
const artifactPolicySchema = z.enum(["inline_only", "promote"]);

const runCodeInputSchema = z.object({
  artifactPolicy: artifactPolicySchema.optional(),
  code: z.string(),
  contextId: z.string().optional(),
  cwd: z.string().optional(),
  language: codeLanguageSchema.optional(),
  timeoutMs: z.number().int().positive().optional(),
});

const runCommandInputSchema = z.object({
  command: z.string(),
  cwd: z.string().optional(),
  timeoutMs: z.number().int().positive().optional(),
});

const readFileInputSchema = z.object({
  maxBytes: z.number().int().positive().max(MAX_READ_FILE_BYTES).optional(),
  path: z.string(),
});

const writeFileInputSchema = z.object({
  content: z.string(),
  createParents: z.boolean().optional(),
  overwrite: z.boolean().optional(),
  path: z.string(),
});

type CodeRunResult = Awaited<ReturnType<CrownestToolSession["client"]["code"]["run"]>>;
type CommandResult = Awaited<
  ReturnType<CrownestToolSession["client"]["commands"]["run"]>
>;
type FileStat = Awaited<ReturnType<CrownestToolSession["client"]["files"]["write"]>>;

type RunCodeInput = z.infer<typeof runCodeInputSchema>;
type RunCommandInput = z.infer<typeof runCommandInputSchema>;

export type CrownestToolSet = ReturnType<typeof createToolSet>;

export function crownestTools(options: CrownestToolsOptions = {}): CrownestToolSet {
  const session = new CrownestToolSession(options);
  const tools = createToolSet(session);
  sessions.set(tools, session);
  return tools;
}

export async function killSession(tools: CrownestToolSet): Promise<void> {
  await sessions.get(tools)?.close();
}

function createToolSet(session: CrownestToolSession) {
  return {
    readFile: tool({
      description:
        "Read a UTF-8 text file from a CrowNest Sandbox Workspace. Uses the session's lazy Sandbox unless the factory pinned sandboxId. Content is capped so large files do not overwhelm the model context.",
      inputSchema: readFileInputSchema,
      execute: (input) =>
        session.runInSandbox(async (sandboxId) => {
          const content = await session.client.files.read(sandboxId, input.path, {
            encoding: "utf8",
          });
          return formatReadFile(sandboxId, input.path, content, input.maxBytes);
        }),
    }),
    runCode: tool({
      description:
        "Run interpreter-style code in a CrowNest Sandbox. Use for Python, JavaScript, or TypeScript snippets, stateful Code Context work, and rich outputs. Returns stdout, stderr, inline outputs, artifacts, rejected outputs, and traceback text on interpreter errors.",
      inputSchema: runCodeInputSchema,
      execute: (input) =>
        session.runInSandbox(async (sandboxId) => {
          const result = await session.client.code.run(sandboxId, codeRunInput(input));
          return formatCodeRun(result);
        }),
    }),
    runCommand: tool({
      description:
        "Run a shell Command in a CrowNest Sandbox and wait for completion. Use for process-level work in /workspace. Returns the Command id, Sandbox id, status, exit code, stdout, and stderr.",
      inputSchema: runCommandInputSchema,
      execute: (input) =>
        session.runInSandbox(async (sandboxId) => {
          const command = await session.client.commands.run(
            sandboxId,
            input.command,
            commandRunInput(input),
          );
          return formatCommand(command);
        }),
    }),
    writeFile: tool({
      description:
        "Write a UTF-8 text file into a CrowNest Sandbox Workspace. Uses the session's lazy Sandbox unless the factory pinned sandboxId. Defaults to creating parent directories for agent-generated paths.",
      inputSchema: writeFileInputSchema,
      execute: (input) =>
        session.runInSandbox(async (sandboxId) => {
          const file = await session.client.files.write(
            sandboxId,
            input.path,
            input.content,
            {
              createParents: input.createParents ?? true,
              encoding: "utf8",
              ...(input.overwrite === undefined ? {} : { overwrite: input.overwrite }),
            },
          );
          return formatFileStat(sandboxId, file);
        }),
    }),
  };
}

function codeRunInput(input: RunCodeInput) {
  return {
    code: input.code,
    ...(input.artifactPolicy === undefined
      ? {}
      : { artifactPolicy: input.artifactPolicy }),
    ...(input.contextId === undefined
      ? {}
      : { contextId: input.contextId as `cctx_${string}` }),
    ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
    ...(input.language === undefined ? {} : { language: input.language }),
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
  };
}

function commandRunInput(input: RunCommandInput) {
  return {
    ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
  };
}

function formatCommand(command: CommandResult): string {
  return [
    `command_id: ${command.id}`,
    `sandbox_id: ${command.sandboxId}`,
    `status: ${command.status}`,
    `exit_code: ${command.exitCode ?? ""}`,
    `stdout:\n${command.stdout ?? ""}`,
    `stderr:\n${command.stderr ?? ""}`,
  ].join("\n");
}

function formatCodeRun(result: CodeRunResult): string {
  const lines = [
    `sandbox_id: ${result.sandboxId}`,
    `context_id: ${result.contextId}`,
    `language: ${result.language}`,
    `execution_count: ${result.executionCount}`,
    ...(result.durationMs === undefined ? [] : [`duration_ms: ${result.durationMs}`]),
    `stdout:\n${result.stdout}`,
    `stderr:\n${result.stderr}`,
    ...formatOutputs(result.outputs),
  ];

  if (result.error !== undefined) {
    lines.push("error:", formatCodeError(result.error));
  }

  return `${lines.join("\n")}\n`;
}

function formatOutputs(outputs: CodeRunResult["outputs"]): string[] {
  if (outputs.length === 0) return [];

  return [
    "outputs:",
    ...outputs.map((output, index) => `${index + 1}. ${formatOutput(output)}`),
  ];
}

function formatOutput(output: CodeRunResult["outputs"][number]): string {
  switch (output.kind) {
    case "artifact":
      return [
        `${output.format} artifact`,
        `artifact_id=${output.artifactId}`,
        `content_type=${output.contentType}`,
        `size_bytes=${output.sizeBytes}`,
      ].join(" ");
    case "inline":
      return `${output.format} inline ${formatInlineValue(output.value)}`;
    case "rejected":
      return `${output.format} rejected reason=${output.reason}`;
  }
}

function formatInlineValue(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function formatCodeError(error: NonNullable<CodeRunResult["error"]>): string {
  return [
    ...(error.name === undefined ? [] : [`name: ${error.name}`]),
    `message: ${error.message}`,
    ...(error.traceback === undefined
      ? []
      : ["traceback:", ...error.traceback.map((line) => line.trimEnd())]),
  ].join("\n");
}

function formatReadFile(
  sandboxId: `sbx_${string}`,
  path: string,
  content: string,
  maxBytes = MAX_READ_FILE_BYTES,
): string {
  const bounded = boundUtf8(content, maxBytes);
  return [
    `sandbox_id: ${sandboxId}`,
    `path: ${path}`,
    `content_bytes: ${bounded.byteLength}`,
    `truncated: ${bounded.truncated}`,
    "content:",
    bounded.content,
    ...(bounded.truncated ? [`[truncated after ${maxBytes} bytes]`] : []),
  ].join("\n");
}

function formatFileStat(sandboxId: `sbx_${string}`, file: FileStat): string {
  return [
    `sandbox_id: ${sandboxId}`,
    `path: ${file.path}`,
    `type: ${file.type}`,
    `size_bytes: ${file.sizeBytes}`,
  ].join("\n");
}

function boundUtf8(value: string, maxBytes: number) {
  const encoder = new TextEncoder();
  const byteLength = encoder.encode(value).byteLength;
  if (byteLength <= maxBytes) {
    return { byteLength, content: value, truncated: false };
  }

  const visible: string[] = [];
  let visibleBytes = 0;
  for (const char of value) {
    const charBytes = encoder.encode(char).byteLength;
    if (visibleBytes + charBytes > maxBytes) break;
    visible.push(char);
    visibleBytes += charBytes;
  }

  return {
    byteLength,
    content: visible.join(""),
    truncated: true,
  };
}
