import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";

import { formatCommand, formatCommandDetails, formatCommandLogs } from "../formatting";
import type { McpSession } from "../session";
import {
  commandIdSchema,
  DEFAULT_COMMAND_LOG_LINES,
  handleTool,
  MAX_COMMAND_LOG_LINES,
  sandboxIdSchema,
} from "./shared";

export function registerRunCommand(server: McpServer, session: McpSession): void {
  server.registerTool(
    "run_command",
    {
      description:
        "Run a Command in a CrowNest Sandbox. Omit sandbox_id to lazily create or reuse the MCP session's default Sandbox; the default cwd is /workspace. Foreground mode is the default: it waits for completion and returns terminal status, exit code, stdout, and stderr. Set background to true to return the started Command immediately, then use get_command or stream_command_logs to follow it.",
      inputSchema: z.object({
        background: z.boolean().default(false),
        command: z.string(),
        cwd: z.string().optional(),
        sandbox_id: sandboxIdSchema.optional(),
        timeout_ms: z.number().int().positive().optional(),
      }),
    },
    (input) =>
      handleTool(async () => {
        const sandbox = await session.resolveSandbox(
          input.sandbox_id as `sbx_${string}` | undefined,
        );
        const commonOptions = {
          ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
          ...(input.timeout_ms === undefined ? {} : { timeoutMs: input.timeout_ms }),
        };
        const command = input.background
          ? await sandbox.commands.run(input.command, {
              ...commonOptions,
              background: true,
            })
          : await sandbox.commands.run(input.command, commonOptions);
        if (input.background) {
          return formatCommandDetails(command);
        }
        return formatCommand({
          commandId: command.id,
          sandboxId: sandbox.id,
          status: command.status,
          stderr: command.stderr ?? "",
          stdout: command.stdout ?? "",
          ...(command.exitCode === undefined ? {} : { exitCode: command.exitCode }),
        });
      }),
  );
}

export function registerGetCommand(server: McpServer, session: McpSession): void {
  server.registerTool(
    "get_command",
    {
      description:
        "Inspect a CrowNest Command by Command id. Returns status, exit code, timing, and Sandbox identity without opening a log stream or changing MCP session Sandbox state.",
      inputSchema: z.object({
        command_id: commandIdSchema,
      }),
    },
    (input) =>
      handleTool(async () =>
        formatCommandDetails(
          await session.client.commands.get(input.command_id as `cmd_${string}`),
        ),
      ),
  );
}

export function registerCancelCommand(server: McpServer, session: McpSession): void {
  server.registerTool(
    "cancel_command",
    {
      description:
        "Cancel a CrowNest Command by Command id. Use graceful for normal termination or force for immediate cancellation; this targets the persisted Command resource rather than raw OS signals.",
      inputSchema: z.object({
        command_id: commandIdSchema,
        mode: z.enum(["graceful", "force"]).optional(),
      }),
    },
    (input) =>
      handleTool(async () =>
        formatCommandDetails(
          await session.client.commands.cancel(input.command_id as `cmd_${string}`, {
            ...(input.mode === undefined ? {} : { mode: input.mode }),
          }),
        ),
      ),
  );
}

export function registerStreamCommandLogs(
  server: McpServer,
  session: McpSession,
): void {
  server.registerTool(
    "stream_command_logs",
    {
      description:
        "Read the currently available CrowNest Command log buffer by Command id. This MCP tool is request/response, so it returns bounded stdout/stderr lines instead of an open subscription and does not mutate Command state.",
      inputSchema: z.object({
        command_id: commandIdSchema,
        max_lines: z.number().int().positive().max(MAX_COMMAND_LOG_LINES).optional(),
      }),
    },
    (input) =>
      handleTool(async () => {
        const maxLines = input.max_lines ?? DEFAULT_COMMAND_LOG_LINES;
        const commandId = input.command_id as `cmd_${string}`;
        const chunksPage = await session.client.commands.logs(commandId, {
          limit: maxLines + 1,
        });
        return formatCommandLogs(commandId, chunksPage.data, maxLines);
      }),
  );
}
