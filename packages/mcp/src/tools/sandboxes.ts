import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";

import { formatSandbox, formatSandboxList, jsonTextResult } from "../formatting";
import type { McpSession } from "../session";
import {
  handleTool,
  paginationCursorSchema,
  paginationInput,
  paginationLimitSchema,
  sandboxIdSchema,
  sandboxStatusSchema,
} from "./shared";

export function registerCreateSandbox(server: McpServer, session: McpSession): void {
  server.registerTool(
    "create_sandbox",
    {
      description:
        "Create an additional CrowNest Sandbox for this MCP server session without changing the lazy default Sandbox used when sandbox_id is omitted. The Sandbox has a Workspace at /workspace, is tracked until killed or MCP session exit cleanup runs, and can be reused by passing sandbox_id.",
      inputSchema: z.object({
        ttl_ms: z.number().int().positive().optional(),
      }),
    },
    (input) =>
      handleTool(async () => {
        const sandbox = await session.createSandbox(
          input.ttl_ms === undefined ? {} : { ttlMs: input.ttl_ms },
        );
        return jsonTextResult({
          expires_at: sandbox.expiresAt,
          sandbox_id: sandbox.id,
        });
      }),
  );
}

export function registerKillSandbox(server: McpServer, session: McpSession): void {
  server.registerTool(
    "kill_sandbox",
    {
      description:
        "Kill a CrowNest Sandbox visible to the configured API Key, including Sandboxes adopted by explicit sandbox_id. This is destructive outside MCP session cleanup; if the killed Sandbox is the lazy default Sandbox, the next tool call that omits sandbox_id creates a new default Sandbox.",
      inputSchema: z.object({
        sandbox_id: sandboxIdSchema,
      }),
    },
    (input) =>
      handleTool(async () => {
        await session.killSandbox(input.sandbox_id as `sbx_${string}`);
        return jsonTextResult({ killed: true, sandbox_id: input.sandbox_id });
      }),
  );
}

export function registerListSandboxes(server: McpServer, session: McpSession): void {
  server.registerTool(
    "list_sandboxes",
    {
      description:
        "List live CrowNest Sandboxes visible to the configured API Key. This is account-visible discovery, not just the MCP session cache; use get_usage to see the Sandboxes this MCP server is tracking.",
      inputSchema: z.object({
        cursor: paginationCursorSchema.optional(),
        limit: paginationLimitSchema.optional(),
        status: sandboxStatusSchema.optional(),
      }),
    },
    (input) =>
      handleTool(async () => {
        const page = await session.client.sandboxes.list(paginationInput(input));
        const filtered =
          input.status === undefined
            ? page.data
            : page.data.filter((sandbox) => sandbox.status === input.status);
        return formatSandboxList(filtered, page);
      }),
  );
}

export function registerGetSandbox(server: McpServer, session: McpSession): void {
  server.registerTool(
    "get_sandbox",
    {
      description:
        "Inspect a CrowNest Sandbox. Pass sandbox_id to inspect a specific Sandbox, or omit sandbox_id to lazily create or reuse the current default Sandbox for this MCP session.",
      inputSchema: z.object({
        sandbox_id: sandboxIdSchema.optional(),
      }),
    },
    (input) =>
      handleTool(async () => {
        const sandbox =
          input.sandbox_id === undefined
            ? await session.resolveDefaultSandbox()
            : await session.client.sandboxes.get(input.sandbox_id as `sbx_${string}`);
        return formatSandbox(sandbox);
      }),
  );
}

export function registerSetSandboxTtl(server: McpServer, session: McpSession): void {
  server.registerTool(
    "set_sandbox_ttl",
    {
      description:
        "Set a live CrowNest Sandbox TTL. This resets the TTL countdown from now to ttl_ms; it does not add ttl_ms to the existing expiry. Pass sandbox_id or omit sandbox_id to update the current lazy default Sandbox; expired Sandboxes cannot be revived.",
      inputSchema: z.object({
        sandbox_id: sandboxIdSchema.optional(),
        ttl_ms: z.number().int().positive(),
      }),
    },
    (input) =>
      handleTool(async () => {
        if (input.sandbox_id === undefined) {
          const sandbox = await (
            await session.resolveDefaultSandbox()
          ).setTtl({ ttlMs: input.ttl_ms });
          session.rememberSandbox(sandbox);
          return formatSandbox(sandbox);
        }

        const sandbox = await session.client.sandboxes.setTtl(
          input.sandbox_id as `sbx_${string}`,
          { ttlMs: input.ttl_ms },
        );
        session.refreshTrackedSandbox(sandbox);
        return formatSandbox(sandbox);
      }),
  );
}
