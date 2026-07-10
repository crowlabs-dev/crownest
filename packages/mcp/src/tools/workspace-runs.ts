import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";

import { jsonTextResult } from "../formatting";
import type { McpSession } from "../session";
import { transferPayload } from "../workspace-run-formatting";
import {
  handleTool,
  idempotencyKeySchema,
  paginationCursorSchema,
  paginationInput,
  paginationLimitSchema,
  projectIdSchema,
  sandboxIdSchema,
  sha256Schema,
  workspaceRunIdSchema,
  workspaceRunUploadIdSchema,
} from "./shared";

const workspaceRunStatusSchema = z.enum([
  "awaiting_archive",
  "archive_uploaded",
  "starting",
  "extracting",
  "running",
  "collecting",
  "succeeded",
  "failed",
  "canceled",
]);

const metadataSchema = z.record(z.string(), z.string());

const workspaceRunArtifactSchema = z.object({
  name: z.string().optional(),
  path: z.string(),
});

export function registerCreateWorkspaceRun(
  server: McpServer,
  session: McpSession,
): void {
  server.registerTool(
    "create_workspace_run",
    {
      description:
        "Create a CrowNest Workspace Run record before archive upload. Use this for repo-level agent tasks that should produce durable status, events, artifacts, and Evidence Bundles.",
      inputSchema: z.object({
        artifacts: z.array(workspaceRunArtifactSchema).optional(),
        command: z.string(),
        idempotency_key: idempotencyKeySchema.optional(),
        keep_sandbox: z.boolean().optional(),
        metadata: metadataSchema.optional(),
        project_id: projectIdSchema.optional(),
        sandbox_id: sandboxIdSchema.optional(),
        source_metadata: metadataSchema.optional(),
        template: z.string().optional(),
        template_version_id: z
          .string()
          .regex(/^tplv_[A-Za-z0-9][A-Za-z0-9_-]*$/u)
          .optional(),
        timeout_ms: z.number().int().positive().optional(),
      }),
    },
    (input) =>
      handleTool(async () =>
        jsonTextResult(
          await session.client.workspaceRuns.create({
            ...(input.artifacts === undefined
              ? {}
              : {
                  artifacts: input.artifacts.map((artifact) =>
                    artifact.name === undefined
                      ? { path: artifact.path }
                      : { name: artifact.name, path: artifact.path },
                  ),
                }),
            command: input.command,
            ...(input.idempotency_key === undefined
              ? {}
              : { idempotencyKey: input.idempotency_key }),
            ...(input.keep_sandbox === undefined
              ? {}
              : { keepSandbox: input.keep_sandbox }),
            ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
            ...(input.project_id === undefined
              ? {}
              : { projectId: input.project_id as `prj_${string}` }),
            ...(input.sandbox_id === undefined
              ? {}
              : { sandboxId: input.sandbox_id as `sbx_${string}` }),
            ...(input.source_metadata === undefined
              ? {}
              : { sourceMetadata: input.source_metadata }),
            ...(input.template === undefined ? {} : { template: input.template }),
            ...(input.template_version_id === undefined
              ? {}
              : { templateVersionId: input.template_version_id as `tplv_${string}` }),
            ...(input.timeout_ms === undefined ? {} : { timeoutMs: input.timeout_ms }),
          }),
        ),
      ),
  );
}

export function registerUploadWorkspaceRunArchive(
  server: McpServer,
  session: McpSession,
): void {
  server.registerTool(
    "upload_workspace_run_archive",
    {
      description:
        "Upload a small .tar.gz/.tgz archive directly to a CrowNest Workspace Run. Direct archive uploads are API-bounded; use the staged transfer tools for larger repositories.",
      inputSchema: z.object({
        content_base64: z.string(),
        idempotency_key: idempotencyKeySchema.optional(),
        sha256: sha256Schema,
        size_bytes: z.number().int().positive(),
        workspace_run_id: workspaceRunIdSchema,
      }),
    },
    (input) =>
      handleTool(async () =>
        jsonTextResult(
          await session.client.workspaceRuns.uploadArchive(
            input.workspace_run_id as `wsr_${string}`,
            {
              bytes: Buffer.from(input.content_base64, "base64"),
              ...(input.idempotency_key === undefined
                ? {}
                : { idempotencyKey: input.idempotency_key }),
              sha256: input.sha256,
              sizeBytes: input.size_bytes,
            },
          ),
        ),
      ),
  );
}

export function registerCreateWorkspaceRunArchiveTransfer(
  server: McpServer,
  session: McpSession,
): void {
  server.registerTool(
    "create_workspace_run_archive_transfer",
    {
      description:
        "Create a staged archive transfer target for a CrowNest Workspace Run. The MCP session remembers the short-lived transfer by upload_id for upload_workspace_run_archive_transfer.",
      inputSchema: z.object({
        idempotency_key: idempotencyKeySchema.optional(),
        sha256: sha256Schema,
        size_bytes: z.number().int().positive(),
        workspace_run_id: workspaceRunIdSchema,
      }),
    },
    (input) =>
      handleTool(async () => {
        const transfer = await session.client.workspaceRuns.createArchiveTransfer(
          input.workspace_run_id as `wsr_${string}`,
          {
            ...(input.idempotency_key === undefined
              ? {}
              : { idempotencyKey: input.idempotency_key }),
            sha256: input.sha256,
            sizeBytes: input.size_bytes,
          },
        );
        session.rememberWorkspaceRunArchiveTransfer(transfer);
        return jsonTextResult(transferPayload(transfer));
      }),
  );
}

export function registerUploadWorkspaceRunArchiveTransfer(
  server: McpServer,
  session: McpSession,
): void {
  server.registerTool(
    "upload_workspace_run_archive_transfer",
    {
      description:
        "Upload archive bytes to a staged Workspace Run archive transfer created earlier in this MCP session. The SDK preserves required transfer headers and strips CrowNest bearer auth from external upload targets.",
      inputSchema: z.object({
        content_base64: z.string(),
        upload_id: workspaceRunUploadIdSchema,
      }),
    },
    (input) =>
      handleTool(async () => {
        const transfer = session.resolveWorkspaceRunArchiveTransfer(
          input.upload_id as `upl_${string}`,
        );
        await session.client.workspaceRuns.uploadArchiveToTransfer(transfer, {
          body: Buffer.from(input.content_base64, "base64"),
        });
        return jsonTextResult({
          uploaded: true,
          upload_id: transfer.id,
          workspace_run_id: transfer.workspaceRunId,
        });
      }),
  );
}

export function registerFinalizeWorkspaceRunArchive(
  server: McpServer,
  session: McpSession,
): void {
  server.registerTool(
    "finalize_workspace_run_archive",
    {
      description:
        "Finalize a staged Workspace Run archive transfer after upload. This verifies checksum/size and moves the run into archive_uploaded.",
      inputSchema: z.object({
        idempotency_key: idempotencyKeySchema.optional(),
        sha256: sha256Schema,
        size_bytes: z.number().int().positive(),
        upload_id: workspaceRunUploadIdSchema,
        workspace_run_id: workspaceRunIdSchema,
      }),
    },
    (input) =>
      handleTool(async () =>
        jsonTextResult(
          await session.client.workspaceRuns.finalizeArchive(
            input.workspace_run_id as `wsr_${string}`,
            {
              ...(input.idempotency_key === undefined
                ? {}
                : { idempotencyKey: input.idempotency_key }),
              sha256: input.sha256,
              sizeBytes: input.size_bytes,
              uploadId: input.upload_id as `upl_${string}`,
            },
          ),
        ),
      ),
  );
}

export function registerStartWorkspaceRun(
  server: McpServer,
  session: McpSession,
): void {
  server.registerTool(
    "start_workspace_run",
    {
      description:
        "Start extraction and command execution for an uploaded CrowNest Workspace Run. Use replay_workspace_run_events for bounded progress reads.",
      inputSchema: z.object({
        idempotency_key: idempotencyKeySchema.optional(),
        workspace_run_id: workspaceRunIdSchema,
      }),
    },
    (input) =>
      handleTool(async () =>
        jsonTextResult(
          await session.client.workspaceRuns.start(
            input.workspace_run_id as `wsr_${string}`,
            input.idempotency_key === undefined
              ? {}
              : { idempotencyKey: input.idempotency_key },
          ),
        ),
      ),
  );
}

export function registerGetWorkspaceRun(server: McpServer, session: McpSession): void {
  server.registerTool(
    "get_workspace_run",
    {
      description:
        "Retrieve CrowNest Workspace Run metadata by id, including current status, sandbox/command ids when available, artifact ids, and failure fields.",
      inputSchema: z.object({
        workspace_run_id: workspaceRunIdSchema,
      }),
    },
    (input) =>
      handleTool(async () =>
        jsonTextResult(
          await session.client.workspaceRuns.get(
            input.workspace_run_id as `wsr_${string}`,
          ),
        ),
      ),
  );
}

export function registerListWorkspaceRuns(
  server: McpServer,
  session: McpSession,
): void {
  server.registerTool(
    "list_workspace_runs",
    {
      description:
        "List Workspace Runs visible to the configured API Key. Filter by project_id, status, and exact metadata labels to find previous agent runs.",
      inputSchema: z.object({
        cursor: paginationCursorSchema.optional(),
        limit: paginationLimitSchema.optional(),
        metadata: metadataSchema.optional(),
        project_id: projectIdSchema.optional(),
        status: workspaceRunStatusSchema.optional(),
      }),
    },
    (input) =>
      handleTool(async () => {
        const page = await session.client.workspaceRuns.list({
          ...paginationInput(input),
          ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
          ...(input.project_id === undefined
            ? {}
            : { projectId: input.project_id as `prj_${string}` }),
          ...(input.status === undefined ? {} : { status: input.status }),
        });
        return jsonTextResult({
          data: page.data,
          has_more: page.hasMore,
          next_cursor: page.nextCursor ?? null,
        });
      }),
  );
}

export function registerReplayWorkspaceRunEvents(
  server: McpServer,
  session: McpSession,
): void {
  server.registerTool(
    "replay_workspace_run_events",
    {
      description:
        "Read a bounded page of Workspace Run events without opening an SSE stream. Use after_seq and nextSeq to resume progress polling.",
      inputSchema: z.object({
        after_seq: z.number().int().nonnegative().optional(),
        limit: z.number().int().positive().max(500).optional(),
        workspace_run_id: workspaceRunIdSchema,
      }),
    },
    (input) =>
      handleTool(async () =>
        jsonTextResult(
          await session.client.workspaceRuns.listEvents(
            input.workspace_run_id as `wsr_${string}`,
            {
              ...(input.after_seq === undefined ? {} : { afterSeq: input.after_seq }),
              ...(input.limit === undefined ? {} : { limit: input.limit }),
            },
          ),
        ),
      ),
  );
}

export function registerCancelWorkspaceRun(
  server: McpServer,
  session: McpSession,
): void {
  server.registerTool(
    "cancel_workspace_run",
    {
      description:
        "Cancel active CrowNest Workspace Run orchestration. Cancellation is persisted on the Workspace Run and visible through get_workspace_run and replay_workspace_run_events.",
      inputSchema: z.object({
        workspace_run_id: workspaceRunIdSchema,
      }),
    },
    (input) =>
      handleTool(async () =>
        jsonTextResult(
          await session.client.workspaceRuns.cancel(
            input.workspace_run_id as `wsr_${string}`,
          ),
        ),
      ),
  );
}

export function registerGetWorkspaceRunEvidence(
  server: McpServer,
  session: McpSession,
): void {
  server.registerTool(
    "get_workspace_run_evidence",
    {
      description:
        "Read the durable Evidence Bundle for a completed Workspace Run, including command result, artifacts, cleanup status, source metadata, and failure classification.",
      inputSchema: z.object({ workspace_run_id: workspaceRunIdSchema }),
    },
    (input) =>
      handleTool(async () =>
        jsonTextResult(
          await session.client.workspaceRuns.evidence(
            input.workspace_run_id as `wsr_${string}`,
          ),
        ),
      ),
  );
}
