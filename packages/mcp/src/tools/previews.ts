import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";

import { formatPreview, formatPreviewCreate, formatPreviewList } from "../formatting";
import type { McpSession } from "../session";
import {
  handleTool,
  paginationCursorSchema,
  paginationInput,
  paginationLimitSchema,
  previewIdSchema,
  sandboxIdSchema,
} from "./shared";

export function registerCreatePreview(server: McpServer, session: McpSession): void {
  server.registerTool(
    "create_preview",
    {
      description:
        "Create a CrowNest Preview for an HTTP service running inside a Sandbox. Omit sandbox_id to lazily create or reuse the MCP session's default Sandbox. Token auth mode returns a one-time Preview token for private browser access; public unauthenticated Preview URLs are not supported.",
      inputSchema: z.object({
        auth_mode: z.enum(["authenticated", "token"]).optional(),
        port: z.number().int().positive(),
        sandbox_id: sandboxIdSchema.optional(),
      }),
    },
    (input) =>
      handleTool(async () => {
        const sandbox = await session.resolveSandbox(
          input.sandbox_id as `sbx_${string}` | undefined,
        );
        const response = await sandbox.previews.create({
          ...(input.auth_mode === undefined ? {} : { authMode: input.auth_mode }),
          port: input.port,
        });
        return formatPreviewCreate(response.preview, response.previewToken);
      }),
  );
}

export function registerListPreviews(server: McpServer, session: McpSession): void {
  server.registerTool(
    "list_previews",
    {
      description:
        "List CrowNest Previews for a Sandbox. Pass sandbox_id or omit sandbox_id to lazily create or reuse the current default Sandbox.",
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
        const page = await sandbox.previews.list(paginationInput(input));
        return formatPreviewList(sandbox.id, page.data, page);
      }),
  );
}

export function registerGetPreview(server: McpServer, session: McpSession): void {
  server.registerTool(
    "get_preview",
    {
      description:
        "Inspect a CrowNest Preview by Preview id. Preview URLs are authenticated or token-mode private browser links, never public unauthenticated links.",
      inputSchema: z.object({
        preview_id: previewIdSchema,
      }),
    },
    (input) =>
      handleTool(async () =>
        formatPreview(
          await session.client.previews.get(input.preview_id as `prv_${string}`),
        ),
      ),
  );
}

export function registerRevokePreview(server: McpServer, session: McpSession): void {
  server.registerTool(
    "revoke_preview",
    {
      description:
        "Revoke a CrowNest Preview by Preview id. Revocation removes Preview access immediately without changing the underlying Sandbox.",
      inputSchema: z.object({
        preview_id: previewIdSchema,
      }),
    },
    (input) =>
      handleTool(async () =>
        formatPreview(
          await session.client.previews.revoke(input.preview_id as `prv_${string}`),
        ),
      ),
  );
}
