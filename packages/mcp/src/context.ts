import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { McpSession } from "./session";

export const AGENT_CONTEXT_RESOURCE_URI = "crownest://agent/context";

export function agentContextMarkdown(session: McpSession): string {
  const snapshot = session.snapshot();
  return [
    "# CrowNest Agent Context",
    "",
    "CrowNest provides cloud Sandboxes, Workspace Runs, Commands, Code Contexts, Workspace files, Artifacts, Previews, Projects, API Key metadata, and usage controls for coding agents.",
    "",
    "## Current MCP Session",
    "",
    `- Default Sandbox: ${snapshot.defaultSandboxId ?? "none"}`,
    `- Tracked Sandboxes: ${snapshot.sandboxIds.length === 0 ? "none" : snapshot.sandboxIds.join(", ")}`,
    "",
    "Session-created Sandboxes are best-effort killed when the MCP server exits. Sandboxes adopted by explicit sandbox_id are usable by this session but are not killed on exit unless kill_sandbox is called.",
    "",
    "## Recommended Workflows",
    "",
    "- Repo-level task: create_workspace_run, upload_workspace_run_archive or staged archive transfer, finalize_workspace_run_archive, start_workspace_run, replay_workspace_run_events, get_workspace_run_evidence.",
    "- Interactive shell task: create_sandbox or omit sandbox_id, run_command with background=true for long work, stream_command_logs for bounded logs, get_command for status.",
    "- Stateful interpreter task: create_code_context when a separate interpreter context is needed, run_code for Python/JavaScript/TypeScript snippets, delete_code_context for cleanup.",
    "- Large output handoff: create_artifact or get_file_download_url, then get_artifact_download_url for durable artifact downloads.",
    "- Discovery and controls: list_projects, list_sandboxes, get_usage, list_api_keys, get_api_key.",
    "",
    "## Idempotency",
    "",
    "Workspace Run create/upload/transfer/finalize/start tools accept idempotency_key. SDK and CLI methods expose idempotency keys for retry-sensitive mutations. If a tool omits an idempotency_key, the SDK may generate one for idempotent API calls where supported.",
    "",
    "## Bounds",
    "",
    "- replay_workspace_run_events returns at most 500 events.",
    "- stream_command_logs is bounded by max_lines and returns request/response text, not an open subscription.",
    "- Direct file bytes and direct archive uploads are API-bounded; use download URLs, Artifacts, or staged archive transfers for larger payloads.",
    "",
    "## Docs",
    "",
    "- Capabilities: https://docs.crownest.dev/docs/api/capabilities",
    "- Agent patterns: https://docs.crownest.dev/docs/guides/agent-patterns",
    "- MCP: https://docs.crownest.dev/docs/integrations/mcp",
    "",
  ].join("\n");
}

export function registerCrowNestContext(server: McpServer, session: McpSession): void {
  server.registerResource(
    "crownest_agent_context",
    AGENT_CONTEXT_RESOURCE_URI,
    {
      description:
        "Bounded CrowNest agent context, current MCP session Sandbox ids, workflow guidance, idempotency notes, and docs links.",
      mimeType: "text/markdown",
      title: "CrowNest Agent Context",
    },
    () => ({
      contents: [
        {
          mimeType: "text/markdown",
          text: agentContextMarkdown(session),
          uri: AGENT_CONTEXT_RESOURCE_URI,
        },
      ],
    }),
  );

  server.registerPrompt(
    "crownest_workspace_run",
    {
      description:
        "Plan a durable repo-level CrowNest Workspace Run with archive upload, event replay, cancellation, and evidence collection.",
      title: "CrowNest Workspace Run",
    },
    () => ({
      messages: [
        {
          content: {
            text: [
              "Use CrowNest Workspace Runs for repo-level tasks that need durable status, event replay, artifacts, and Evidence Bundles.",
              "Create a Workspace Run, upload or stage the archive, finalize it, start it, poll replay_workspace_run_events until terminal, then read get_workspace_run_evidence.",
              "Use idempotency_key on create/upload/transfer/finalize/start when retrying.",
            ].join("\n"),
            type: "text",
          },
          role: "user",
        },
      ],
    }),
  );

  server.registerPrompt(
    "crownest_sandbox_session",
    {
      description:
        "Use a CrowNest Sandbox for interactive commands, code execution, file operations, previews, and artifacts.",
      title: "CrowNest Sandbox Session",
    },
    () => ({
      messages: [
        {
          content: {
            text: [
              "Use CrowNest Sandboxes for interactive cloud execution with /workspace as the workspace root.",
              "Omit sandbox_id to use the lazy MCP default Sandbox, or pass sandbox_id to adopt a visible Sandbox without making it exit-owned.",
              "Use run_command with background=true plus stream_command_logs for long-running commands, run_code for stateful interpreter work, and Artifacts or download URLs for large outputs.",
            ].join("\n"),
            type: "text",
          },
          role: "user",
        },
      ],
    }),
  );
}
