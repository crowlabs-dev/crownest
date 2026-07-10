import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";

import { formatCodeContext, formatCodeContextList, formatCodeRun } from "../formatting";
import type { McpSession } from "../session";
import {
  codeContextIdSchema,
  handleTool,
  paginationCursorSchema,
  paginationInput,
  paginationLimitSchema,
  sandboxIdSchema,
} from "./shared";

export function registerRunCode(server: McpServer, session: McpSession): void {
  server.registerTool(
    "run_code",
    {
      description:
        "Run Python code in a CrowNest Sandbox. Omit sandbox_id to lazily create or reuse the MCP session's default Sandbox. The Workspace is /workspace, variables/imports persist in the Sandbox's Code Context, display outputs auto-promote to Artifacts when possible, and oversized/unsafe/unsupported outputs are reported as rejected outputs.",
      inputSchema: z.object({
        code: z.string(),
        sandbox_id: sandboxIdSchema.optional(),
        timeout_ms: z.number().int().positive().optional(),
      }),
    },
    (input) =>
      handleTool(async () => {
        const sandbox = await session.resolveSandbox(
          input.sandbox_id as `sbx_${string}` | undefined,
        );
        const result = await sandbox.code.run({
          artifactPolicy: "promote",
          code: input.code,
          ...(input.timeout_ms === undefined ? {} : { timeoutMs: input.timeout_ms }),
        });
        return formatCodeRun(result);
      }),
  );
}

export function registerCreateCodeContext(
  server: McpServer,
  session: McpSession,
): void {
  server.registerTool(
    "create_code_context",
    {
      description:
        "Create a CrowNest Code Context in a Sandbox for persisted interpreter state. Omit sandbox_id to lazily create or reuse the MCP session's default Sandbox; pass sandbox_id to target and adopt a visible Sandbox.",
      inputSchema: z.object({
        cwd: z.string().optional(),
        language: z.enum(["python", "javascript", "typescript"]).optional(),
        sandbox_id: sandboxIdSchema.optional(),
        timeout_ms: z.number().int().positive().optional(),
      }),
    },
    (input) =>
      handleTool(async () => {
        const sandbox = await session.resolveSandbox(
          input.sandbox_id as `sbx_${string}` | undefined,
        );
        return formatCodeContext(
          await sandbox.code.createContext({
            ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
            ...(input.language === undefined ? {} : { language: input.language }),
            ...(input.timeout_ms === undefined ? {} : { timeoutMs: input.timeout_ms }),
          }),
        );
      }),
  );
}

export function registerListCodeContexts(server: McpServer, session: McpSession): void {
  server.registerTool(
    "list_code_contexts",
    {
      description:
        "List live CrowNest Code Contexts in a Sandbox. Pass sandbox_id or omit sandbox_id to lazily create or reuse the current default Sandbox; Code Contexts hold persisted variables/imports for run_code.",
      inputSchema: z.object({
        cursor: paginationCursorSchema.optional(),
        limit: paginationLimitSchema.optional(),
        sandbox_id: sandboxIdSchema.optional(),
      }),
    },
    (input) =>
      handleTool(async () => {
        const sandbox = await session.resolveSandbox(
          input.sandbox_id as `sbx_${string}` | undefined,
        );
        const page = await sandbox.code.listContexts(paginationInput(input));
        return formatCodeContextList(sandbox.id, page.data, page);
      }),
  );
}

export function registerGetCodeContext(server: McpServer, session: McpSession): void {
  server.registerTool(
    "get_code_context",
    {
      description:
        "Inspect a live CrowNest Code Context in a Sandbox. Pass sandbox_id or omit sandbox_id to lazily create or reuse the current default Sandbox; context ids are cctx_... values returned by run_code and list_code_contexts.",
      inputSchema: z.object({
        code_context_id: codeContextIdSchema,
        sandbox_id: sandboxIdSchema.optional(),
      }),
    },
    (input) =>
      handleTool(async () => {
        const sandbox = await session.resolveSandbox(
          input.sandbox_id as `sbx_${string}` | undefined,
        );
        return formatCodeContext(
          await sandbox.code.getContext(input.code_context_id as `cctx_${string}`),
        );
      }),
  );
}

export function registerDeleteCodeContext(
  server: McpServer,
  session: McpSession,
): void {
  server.registerTool(
    "delete_code_context",
    {
      description:
        "Delete a live CrowNest Code Context in a Sandbox. Pass sandbox_id or omit sandbox_id to lazily create or reuse the current default Sandbox; deleted contexts cannot be reused by run_code.",
      inputSchema: z.object({
        code_context_id: codeContextIdSchema,
        sandbox_id: sandboxIdSchema.optional(),
      }),
    },
    (input) =>
      handleTool(async () => {
        const sandbox = await session.resolveSandbox(
          input.sandbox_id as `sbx_${string}` | undefined,
        );
        return formatCodeContext(
          await sandbox.code.deleteContext(input.code_context_id as `cctx_${string}`),
        );
      }),
  );
}
