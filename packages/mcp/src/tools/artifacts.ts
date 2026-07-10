import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";

import {
  formatArtifact,
  formatArtifactDownload,
  formatArtifactList,
  jsonTextResult,
} from "../formatting";
import type { McpSession } from "../session";
import {
  artifactIdSchema,
  handleTool,
  paginationCursorSchema,
  paginationInput,
  paginationLimitSchema,
  sandboxIdSchema,
} from "./shared";

export function registerDownloadArtifact(server: McpServer, session: McpSession): void {
  server.registerTool(
    "download_artifact",
    {
      description:
        "Download a durable CrowNest Artifact by Artifact id. Returns base64 content and content type so MCP hosts can render images or other promoted outputs.",
      inputSchema: z.object({
        artifact_id: artifactIdSchema,
      }),
    },
    (input) =>
      handleTool(async () => {
        const artifactId = input.artifact_id as `art_${string}`;
        const artifact = await session.client.artifacts.get(artifactId);
        const bytes = await session.client.artifacts.download(artifactId);
        return formatArtifactDownload(artifact, bytes);
      }),
  );
}

export function registerGetArtifactDownloadUrl(
  server: McpServer,
  session: McpSession,
): void {
  server.registerTool(
    "get_artifact_download_url",
    {
      description:
        "Create or reuse a short-lived download URL for a durable CrowNest Artifact. Use this for larger Artifacts instead of returning base64 content through download_artifact.",
      inputSchema: z.object({
        artifact_id: artifactIdSchema,
      }),
    },
    (input) =>
      handleTool(async () =>
        jsonTextResult(
          await session.client.artifacts.downloadUrl(
            input.artifact_id as `art_${string}`,
          ),
        ),
      ),
  );
}

export function registerCreateArtifact(server: McpServer, session: McpSession): void {
  server.registerTool(
    "create_artifact",
    {
      description:
        "Create a durable CrowNest Artifact from a file in a Sandbox Workspace. Use source_path under /workspace; omit sandbox_id to lazily create or reuse the MCP session's default Sandbox, or pass sandbox_id to target a non-default Sandbox.",
      inputSchema: z.object({
        name: z.string().optional(),
        sandbox_id: sandboxIdSchema.optional(),
        source_path: z.string(),
      }),
    },
    (input) =>
      handleTool(async () => {
        const sandbox = await session.resolveSandbox(
          input.sandbox_id as `sbx_${string}` | undefined,
        );
        const artifact = await sandbox.artifacts.create({
          ...(input.name === undefined ? {} : { name: input.name }),
          path: input.source_path,
        });
        return formatArtifact(artifact);
      }),
  );
}

export function registerListArtifacts(server: McpServer, session: McpSession): void {
  server.registerTool(
    "list_artifacts",
    {
      description:
        "List durable CrowNest Artifacts created from a Sandbox Workspace. Pass sandbox_id or omit sandbox_id to lazily create or reuse the current default Sandbox.",
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
        const page = await sandbox.artifacts.list(paginationInput(input));
        return formatArtifactList(sandbox.id, page.data, page);
      }),
  );
}

export function registerGetArtifact(server: McpServer, session: McpSession): void {
  server.registerTool(
    "get_artifact",
    {
      description:
        "Inspect durable CrowNest Artifact metadata by Artifact id. This returns metadata only; use download_artifact for bytes.",
      inputSchema: z.object({
        artifact_id: artifactIdSchema,
      }),
    },
    (input) =>
      handleTool(async () =>
        formatArtifact(
          await session.client.artifacts.get(input.artifact_id as `art_${string}`),
        ),
      ),
  );
}

export function registerDeleteArtifact(server: McpServer, session: McpSession): void {
  server.registerTool(
    "delete_artifact",
    {
      description:
        "Delete a durable CrowNest Artifact by Artifact id. Artifact deletion removes future access and keeps only internal tombstone metadata.",
      inputSchema: z.object({
        artifact_id: artifactIdSchema,
      }),
    },
    (input) =>
      handleTool(async () =>
        formatArtifact(
          await session.client.artifacts.delete(input.artifact_id as `art_${string}`),
        ),
      ),
  );
}
