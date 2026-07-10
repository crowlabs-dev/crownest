import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";

import { toolError } from "../errors";
import type { McpSession } from "../session";

export const COMMAND_LOG_REPLAY_LIMIT = 100;
export const DEFAULT_COMMAND_LOG_LINES = COMMAND_LOG_REPLAY_LIMIT - 1;
export const MAX_COMMAND_LOG_LINES = COMMAND_LOG_REPLAY_LIMIT - 1;

export type ToolRegistrar = (server: McpServer, session: McpSession) => void;

// Use representable string+pattern schemas, NOT z.custom(): z.custom() has no
// JSON Schema form, so MCP `tools/list` cannot serialize those schemas.
export const sandboxIdSchema = z
  .string()
  .regex(/^sbx_[A-Za-z0-9][A-Za-z0-9_-]*$/u, "Expected a Sandbox id like sbx_...");
export const projectIdSchema = z
  .string()
  .regex(/^prj_[A-Za-z0-9][A-Za-z0-9_-]*$/u, "Expected a Project id like prj_...");
export const commandIdSchema = z
  .string()
  .regex(/^cmd_[A-Za-z0-9][A-Za-z0-9_-]*$/u, "Expected a Command id like cmd_...");
export const artifactIdSchema = z
  .string()
  .regex(/^art_[A-Za-z0-9][A-Za-z0-9_-]*$/u, "Expected an Artifact id like art_...");
export const workspaceRunIdSchema = z
  .string()
  .regex(
    /^wsr_[A-Za-z0-9][A-Za-z0-9_-]*$/u,
    "Expected a Workspace Run id like wsr_...",
  );
export const workspaceRunUploadIdSchema = z
  .string()
  .regex(
    /^upl_[A-Za-z0-9][A-Za-z0-9_-]*$/u,
    "Expected a Workspace Run archive upload id like upl_...",
  );
export const previewIdSchema = z
  .string()
  .regex(/^prv_[A-Za-z0-9][A-Za-z0-9_-]*$/u, "Expected a Preview id like prv_...");
export const codeContextIdSchema = z
  .string()
  .regex(
    /^cctx_[A-Za-z0-9][A-Za-z0-9_-]*$/u,
    "Expected a Code Context id like cctx_...",
  );
export const apiKeyIdSchema = z
  .string()
  .regex(/^key_[A-Za-z0-9][A-Za-z0-9_-]*$/u, "Expected an API Key id like key_...");
export const sha256Schema = z
  .string()
  .regex(/^[a-fA-F0-9]{64}$/u, "Expected a 64-character hex sha256 digest.");
export const idempotencyKeySchema = z.string().min(1).max(255);
export const paginationCursorSchema = z.string().min(1);
export const paginationLimitSchema = z.number().int().positive().max(500);
export const sandboxStatusSchema = z.enum([
  "creating",
  "starting",
  "ready",
  "running",
  "idle",
  "expiring",
]);

export function paginationInput(input: {
  readonly cursor?: string | undefined;
  readonly limit?: number | undefined;
}): { readonly cursor?: string; readonly limit?: number } {
  return {
    ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
    ...(input.limit === undefined ? {} : { limit: input.limit }),
  };
}

export async function handleTool(
  callback: () => Promise<CallToolResult>,
): Promise<CallToolResult> {
  try {
    return await callback();
  } catch (error) {
    return toolError(error);
  }
}
