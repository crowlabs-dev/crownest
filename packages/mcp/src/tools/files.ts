import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";

import { formatFiles, formatFileStat, jsonTextResult } from "../formatting";
import type { McpSession } from "../session";
import { handleTool, sandboxIdSchema } from "./shared";

export function registerWriteFile(server: McpServer, session: McpSession): void {
  server.registerTool(
    "write_file",
    {
      description:
        "Write a utf-8 text file in a CrowNest Sandbox Workspace. Use paths under /workspace; omit sandbox_id to lazily create or reuse the MCP session's default Sandbox, or pass sandbox_id to target a non-default Sandbox.",
      inputSchema: z.object({
        content: z.string(),
        path: z.string(),
        sandbox_id: sandboxIdSchema.optional(),
      }),
    },
    (input) =>
      handleTool(async () => {
        const sandbox = await session.resolveSandbox(
          input.sandbox_id as `sbx_${string}` | undefined,
        );
        const file = await sandbox.files.write(input.path, input.content, {
          encoding: "utf8",
        });
        return jsonTextResult({ file, sandbox_id: sandbox.id });
      }),
  );
}

export function registerWriteFileBytes(server: McpServer, session: McpSession): void {
  server.registerTool(
    "write_file_bytes",
    {
      description:
        "Write a small binary file in a CrowNest Sandbox Workspace from base64 content. Direct byte writes are API-bounded; use staged uploads or Artifacts for larger files.",
      inputSchema: z.object({
        content_base64: z.string(),
        create_parents: z.boolean().optional(),
        overwrite: z.boolean().optional(),
        path: z.string(),
        sandbox_id: sandboxIdSchema.optional(),
      }),
    },
    (input) =>
      handleTool(async () => {
        const sandbox = await session.resolveSandbox(
          input.sandbox_id as `sbx_${string}` | undefined,
        );
        const file = await sandbox.files.writeBytes(
          input.path,
          Buffer.from(input.content_base64, "base64"),
          {
            ...(input.create_parents === undefined
              ? {}
              : { createParents: input.create_parents }),
            ...(input.overwrite === undefined ? {} : { overwrite: input.overwrite }),
          },
        );
        return jsonTextResult({ file, sandbox_id: sandbox.id });
      }),
  );
}

export function registerReadFile(server: McpServer, session: McpSession): void {
  server.registerTool(
    "read_file",
    {
      description:
        "Read a utf-8 text file from a CrowNest Sandbox Workspace. Use paths under /workspace; omit sandbox_id to lazily create or reuse the MCP session's default Sandbox, or pass sandbox_id to target a non-default Sandbox.",
      inputSchema: z.object({
        path: z.string(),
        sandbox_id: sandboxIdSchema.optional(),
      }),
    },
    (input) =>
      handleTool(async () => {
        const sandbox = await session.resolveSandbox(
          input.sandbox_id as `sbx_${string}` | undefined,
        );
        const content = await sandbox.files.read(input.path, { encoding: "utf8" });
        return jsonTextResult({
          content,
          path: input.path,
          sandbox_id: sandbox.id,
        });
      }),
  );
}

export function registerReadFileBytes(server: McpServer, session: McpSession): void {
  server.registerTool(
    "read_file_bytes",
    {
      description:
        "Read a small binary file from a CrowNest Sandbox Workspace as base64 content. Direct byte reads are API-bounded; use get_file_download_url or Artifacts for larger files.",
      inputSchema: z.object({
        path: z.string(),
        sandbox_id: sandboxIdSchema.optional(),
      }),
    },
    (input) =>
      handleTool(async () => {
        const sandbox = await session.resolveSandbox(
          input.sandbox_id as `sbx_${string}` | undefined,
        );
        const bytes = await sandbox.files.readBytes(input.path);
        return jsonTextResult({
          content_base64: Buffer.from(bytes).toString("base64"),
          path: input.path,
          sandbox_id: sandbox.id,
        });
      }),
  );
}

export function registerGetFileDownloadUrl(
  server: McpServer,
  session: McpSession,
): void {
  server.registerTool(
    "get_file_download_url",
    {
      description:
        "Create or reuse a short-lived download URL for a file in a CrowNest Sandbox Workspace. Use this for larger files instead of direct read_file or read_file_bytes payloads.",
      inputSchema: z.object({
        path: z.string(),
        sandbox_id: sandboxIdSchema.optional(),
      }),
    },
    (input) =>
      handleTool(async () => {
        const sandbox = await session.resolveSandbox(
          input.sandbox_id as `sbx_${string}` | undefined,
        );
        return jsonTextResult({
          ...(await sandbox.files.downloadUrl(input.path)),
          path: input.path,
          sandbox_id: sandbox.id,
        });
      }),
  );
}

export function registerListFiles(server: McpServer, session: McpSession): void {
  server.registerTool(
    "list_files",
    {
      description:
        "List files in a CrowNest Sandbox Workspace. Defaults to /workspace; omit sandbox_id to lazily create or reuse the MCP session's default Sandbox, and returns file entries with the sandbox_id.",
      inputSchema: z.object({
        path: z.string().optional(),
        sandbox_id: sandboxIdSchema.optional(),
      }),
    },
    (input) =>
      handleTool(async () => {
        const sandbox = await session.resolveSandbox(
          input.sandbox_id as `sbx_${string}` | undefined,
        );
        const filesPage = await sandbox.files.list(input.path);
        return formatFiles(sandbox.id, filesPage.data);
      }),
  );
}

export function registerDeleteFile(server: McpServer, session: McpSession): void {
  server.registerTool(
    "delete_file",
    {
      description:
        "Delete a file or empty directory from a CrowNest Sandbox Workspace. Use paths under /workspace; omit sandbox_id to lazily create or reuse the MCP session's default Sandbox, or pass sandbox_id to target a non-default Sandbox.",
      inputSchema: z.object({
        path: z.string(),
        sandbox_id: sandboxIdSchema.optional(),
      }),
    },
    (input) =>
      handleTool(async () => {
        const sandbox = await session.resolveSandbox(
          input.sandbox_id as `sbx_${string}` | undefined,
        );
        await sandbox.files.delete(input.path);
        return jsonTextResult({
          deleted: true,
          path: input.path,
          sandbox_id: sandbox.id,
        });
      }),
  );
}

export function registerMoveFile(server: McpServer, session: McpSession): void {
  server.registerTool(
    "move_file",
    {
      description:
        "Move or rename a file inside a CrowNest Sandbox Workspace. Use paths under /workspace; omit sandbox_id to lazily create or reuse the MCP session's default Sandbox, or pass sandbox_id to target a non-default Sandbox.",
      inputSchema: z.object({
        from: z.string(),
        overwrite: z.boolean().optional(),
        sandbox_id: sandboxIdSchema.optional(),
        to: z.string(),
      }),
    },
    (input) =>
      handleTool(async () => {
        const sandbox = await session.resolveSandbox(
          input.sandbox_id as `sbx_${string}` | undefined,
        );
        const file = await sandbox.files.move(input.from, input.to, {
          ...(input.overwrite === undefined ? {} : { overwrite: input.overwrite }),
        });
        return formatFileStat(sandbox.id, file);
      }),
  );
}

export function registerMakeDirectory(server: McpServer, session: McpSession): void {
  server.registerTool(
    "make_directory",
    {
      description:
        "Create a directory inside a CrowNest Sandbox Workspace. Use paths under /workspace; omit sandbox_id to lazily create or reuse the MCP session's default Sandbox, or pass sandbox_id to target a non-default Sandbox.",
      inputSchema: z.object({
        parents: z.boolean().optional(),
        path: z.string(),
        sandbox_id: sandboxIdSchema.optional(),
      }),
    },
    (input) =>
      handleTool(async () => {
        const sandbox = await session.resolveSandbox(
          input.sandbox_id as `sbx_${string}` | undefined,
        );
        const file = await sandbox.files.mkdir(input.path, {
          ...(input.parents === undefined ? {} : { parents: input.parents }),
        });
        return formatFileStat(sandbox.id, file);
      }),
  );
}

export function registerStatFile(server: McpServer, session: McpSession): void {
  server.registerTool(
    "stat_file",
    {
      description:
        "Inspect file metadata in a CrowNest Sandbox Workspace. Use paths under /workspace; omit sandbox_id to lazily create or reuse the MCP session's default Sandbox, or pass sandbox_id to target a non-default Sandbox.",
      inputSchema: z.object({
        path: z.string(),
        sandbox_id: sandboxIdSchema.optional(),
      }),
    },
    (input) =>
      handleTool(async () => {
        const sandbox = await session.resolveSandbox(
          input.sandbox_id as `sbx_${string}` | undefined,
        );
        const file = await sandbox.files.stat(input.path);
        return formatFileStat(sandbox.id, file);
      }),
  );
}
