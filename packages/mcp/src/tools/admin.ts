import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";

import {
  formatApiKey,
  formatApiKeyList,
  formatProject,
  formatProjectList,
} from "../formatting";
import type { McpSession } from "../session";
import {
  apiKeyIdSchema,
  handleTool,
  paginationCursorSchema,
  paginationInput,
  paginationLimitSchema,
} from "./shared";

export function registerListApiKeys(server: McpServer, session: McpSession): void {
  server.registerTool(
    "list_api_keys",
    {
      description:
        "List CrowNest API Key metadata visible to the configured credential. Secret key values are never returned; this is for discovery and cleanup, not credential creation.",
      inputSchema: z.object({
        cursor: paginationCursorSchema.optional(),
        limit: paginationLimitSchema.optional(),
      }),
    },
    (input) =>
      handleTool(async () => {
        const page = await session.client.apiKeys.list(paginationInput(input));
        return formatApiKeyList(page.data, page);
      }),
  );
}

export function registerGetApiKey(server: McpServer, session: McpSession): void {
  server.registerTool(
    "get_api_key",
    {
      description:
        "Retrieve CrowNest API Key metadata by API Key id. Secret key values are never returned; project restrictions and scopes are included when visible.",
      inputSchema: z.object({
        api_key_id: apiKeyIdSchema,
      }),
    },
    (input) =>
      handleTool(async () =>
        formatApiKey(
          await session.client.apiKeys.get(input.api_key_id as `key_${string}`),
        ),
      ),
  );
}

export function registerRevokeApiKey(server: McpServer, session: McpSession): void {
  server.registerTool(
    "revoke_api_key",
    {
      description:
        "Revoke a CrowNest API Key by API Key id. This removes machine access immediately and never returns secret key material.",
      inputSchema: z.object({
        api_key_id: apiKeyIdSchema,
      }),
    },
    (input) =>
      handleTool(async () =>
        formatApiKey(
          await session.client.apiKeys.revoke(input.api_key_id as `key_${string}`),
        ),
      ),
  );
}

export function registerCreateProject(server: McpServer, session: McpSession): void {
  server.registerTool(
    "create_project",
    {
      description:
        "Create a CrowNest Project for isolating Sandboxes, usage, quotas, and API-key restrictions. Project creation does not create Sandboxes or API Keys.",
      inputSchema: z.object({
        name: z.string().min(1),
      }),
    },
    (input) =>
      handleTool(async () =>
        formatProject(await session.client.projects.create({ name: input.name })),
      ),
  );
}

export function registerListProjects(server: McpServer, session: McpSession): void {
  server.registerTool(
    "list_projects",
    {
      description:
        "List CrowNest Projects visible to the configured credential. Use this as the read path for Project ids before creating Sandboxes, Workspace Runs, or API-key restrictions.",
      inputSchema: z.object({
        cursor: paginationCursorSchema.optional(),
        limit: paginationLimitSchema.optional(),
      }),
    },
    (input) =>
      handleTool(async () => {
        const page = await session.client.projects.list(paginationInput(input));
        return formatProjectList(page.data, page);
      }),
  );
}
