import { describe, expect, it } from "vitest";

import {
  apiKeyIdSchema,
  artifactIdSchema,
  codeContextIdSchema,
  commandIdSchema,
  previewIdSchema,
  projectIdSchema,
  sandboxIdSchema,
  workspaceRunIdSchema,
  workspaceRunUploadIdSchema,
} from "../tools/shared";
import { createHarness } from "./mcp-test-helpers";

const toolNames = [
  "run_code",
  "get_agent_context",
  "run_command",
  "create_sandbox",
  "kill_sandbox",
  "write_file",
  "write_file_bytes",
  "read_file",
  "read_file_bytes",
  "get_file_download_url",
  "list_files",
  "download_artifact",
  "get_artifact_download_url",
  "list_sandboxes",
  "get_usage",
  "get_sandbox",
  "set_sandbox_ttl",
  "get_command",
  "cancel_command",
  "stream_command_logs",
  "delete_file",
  "move_file",
  "make_directory",
  "stat_file",
  "create_artifact",
  "list_artifacts",
  "get_artifact",
  "delete_artifact",
  "create_preview",
  "list_previews",
  "get_preview",
  "revoke_preview",
  "create_code_context",
  "list_code_contexts",
  "get_code_context",
  "delete_code_context",
  "list_api_keys",
  "get_api_key",
  "revoke_api_key",
  "create_project",
  "list_projects",
  "create_workspace_run",
  "upload_workspace_run_archive",
  "create_workspace_run_archive_transfer",
  "upload_workspace_run_archive_transfer",
  "finalize_workspace_run_archive",
  "start_workspace_run",
  "get_workspace_run",
  "list_workspace_runs",
  "replay_workspace_run_events",
  "cancel_workspace_run",
  "get_workspace_run_evidence",
];

describe("registerCrowNestTools", () => {
  it("registers the SDK parity tools with CrowNest descriptions", () => {
    const { calls, tools } = createHarness();

    expect(calls.map((call) => call.name)).toEqual(toolNames);
    expect(calls).toHaveLength(52);
    expect(new Set(calls.map((call) => call.name)).size).toBe(52);
    expect([...tools.keys()]).toEqual(toolNames);
    expectPromptNativeDescriptions(tools);
  });

  it("accepts empty arguments for all-optional tools", () => {
    const { tools } = createHarness();

    expect(parseToolInput(tools, "create_sandbox", {})).toEqual({});
    expect(parseToolInput(tools, "get_agent_context", {})).toEqual({});
    expect(parseToolInput(tools, "run_command", { command: "pwd" })).toEqual({
      background: false,
      command: "pwd",
    });
    expect(
      parseToolInput(tools, "run_command", {
        background: true,
        command: "pnpm test",
      }),
    ).toEqual({ background: true, command: "pnpm test" });
    expect(parseToolInput(tools, "list_files", {})).toEqual({});
    expect(parseToolInput(tools, "list_sandboxes", {})).toEqual({});
    expect(parseToolInput(tools, "get_sandbox", {})).toEqual({});
    expect(parseToolInput(tools, "get_usage", {})).toEqual({});
    expect(parseToolInput(tools, "list_artifacts", {})).toEqual({});
    expect(parseToolInput(tools, "list_previews", {})).toEqual({});
    expect(parseToolInput(tools, "list_code_contexts", {})).toEqual({});
    expect(parseToolInput(tools, "list_api_keys", {})).toEqual({});
    expect(parseToolInput(tools, "list_projects", {})).toEqual({});
    expect(parseToolInput(tools, "list_workspace_runs", {})).toEqual({});
    expect(parseToolInput(tools, "list_workspace_runs", { limit: 25 })).toEqual({
      limit: 25,
    });
  });

  it("rejects MCP inputs outside the reachable API surface", () => {
    const { tools } = createHarness();

    expect(
      rejectsToolInput(tools, "stream_command_logs", {
        command_id: "cmd_123",
        max_lines: 100,
      }),
    ).toBe(true);
    expect(
      rejectsToolInput(tools, "list_sandboxes", {
        status: "destroyed",
      }),
    ).toBe(true);
    expect(
      rejectsToolInput(tools, "list_sandboxes", {
        status: "failed",
      }),
    ).toBe(true);
  });
});

describe("tool input validation", () => {
  it("accepts one-page pagination inputs and enforces the server limit", () => {
    const { tools } = createHarness();
    const paginatedTools = [
      "list_sandboxes",
      "list_artifacts",
      "list_previews",
      "list_code_contexts",
      "list_api_keys",
      "list_projects",
      "list_workspace_runs",
    ] as const;

    for (const name of paginatedTools) {
      expect(parseToolInput(tools, name, { cursor: "next_page", limit: 500 })).toEqual({
        cursor: "next_page",
        limit: 500,
      });
      expect(rejectsToolInput(tools, name, { limit: 501 })).toBe(true);
      expect(rejectsToolInput(tools, name, { limit: 0 })).toBe(true);
      expect(rejectsToolInput(tools, name, { cursor: "" })).toBe(true);
    }
  });

  it("rejects path-like resource IDs before SDK URL construction", () => {
    const schemaCases = [
      [sandboxIdSchema, "sbx_valid-123", "sbx_x/../../previews/prv_live"],
      [commandIdSchema, "cmd_valid-123", "cmd_x/../../sandboxes/sbx_live"],
      [artifactIdSchema, "art_valid-123", "art_x?path=/v1/sandboxes/sbx_live"],
      [previewIdSchema, "prv_valid-123", "prv_x/../../sandboxes/sbx_live"],
      [codeContextIdSchema, "cctx_valid-123", "cctx_x#fragment"],
      [apiKeyIdSchema, "key_valid-123", "key_x%2F..%2Fsandboxes%2Fsbx_live"],
      [projectIdSchema, "prj_valid-123", "prj_x/../../sandboxes/sbx_live"],
      [workspaceRunIdSchema, "wsr_valid-123", "wsr_x?events=true"],
      [
        workspaceRunUploadIdSchema,
        "upl_valid-123",
        "upl_x/../../workspace-runs/wsr_live",
      ],
    ] as const;

    for (const [schema, validId, invalidId] of schemaCases) {
      expect(schema.safeParse(validId).success).toBe(true);
      expect(schema.safeParse(invalidId).success).toBe(false);
    }
  });
});

function expectPromptNativeDescriptions(
  tools: ReadonlyMap<string, { readonly config: { readonly description?: string } }>,
): void {
  expectDescription(tools, "run_code", [
    "Omit sandbox_id",
    "/workspace",
    "variables/imports persist",
    "auto-promote to Artifacts",
    "rejected outputs",
  ]);
  expectDescription(tools, "get_agent_context", ["bounded CrowNest agent context"]);
  expectDescription(tools, "run_command", [
    "Foreground mode is the default",
    "waits for completion",
    "background to true",
    "get_command",
    "stream_command_logs",
  ]);
  expectDescription(tools, "create_sandbox", [
    "without changing the lazy default Sandbox",
    "MCP session exit cleanup",
  ]);
  expectDescription(tools, "set_sandbox_ttl", [
    "resets the TTL countdown from now to ttl_ms",
    "does not add ttl_ms",
    "cannot be revived",
  ]);
  expectDescription(tools, "get_usage", [
    "compute usage",
    "quotas",
    "MCP-session Sandbox state",
    "does not create or mutate Sandboxes",
  ]);
  expectDescription(tools, "download_artifact", ["durable CrowNest Artifact"]);
  expectDescription(tools, "get_artifact_download_url", ["short-lived"]);
  expectDescription(tools, "create_preview", [
    "Token auth mode",
    "one-time Preview token",
    "public unauthenticated Preview URLs are not supported",
  ]);
  expect(tools.get("list_api_keys")?.config.description).toContain(
    "Secret key values are never returned",
  );
  expect(tools.get("create_workspace_run")?.config.description).toContain(
    "Evidence Bundles",
  );
  expect(tools.get("replay_workspace_run_events")?.config.description).toContain(
    "bounded page",
  );
}

function expectDescription(
  tools: ReadonlyMap<string, { readonly config: { readonly description?: string } }>,
  name: string,
  expected: readonly string[],
): void {
  const description = tools.get(name)?.config.description ?? "";

  for (const value of expected) {
    expect(description).toContain(value);
  }
}

function parseToolInput(
  tools: ReadonlyMap<string, { readonly config: { readonly inputSchema?: unknown } }>,
  name: string,
  input: unknown,
): unknown {
  const schema = tools.get(name)?.config.inputSchema;
  if (!isSafeParsableSchema(schema)) {
    throw new Error(`Tool ${name} does not expose a parsable input schema.`);
  }

  const result = schema.safeParse(input);
  if (!result.success) {
    throw new Error(`Tool ${name} rejected input.`);
  }

  return result.data;
}

function rejectsToolInput(
  tools: ReadonlyMap<string, { readonly config: { readonly inputSchema?: unknown } }>,
  name: string,
  input: unknown,
): boolean {
  const schema = tools.get(name)?.config.inputSchema;
  if (!isSafeParsableSchema(schema)) {
    throw new Error(`Tool ${name} does not expose a parsable input schema.`);
  }

  return !schema.safeParse(input).success;
}

function isSafeParsableSchema(
  value: unknown,
): value is { readonly safeParse: (input: unknown) => SafeParseResult } {
  return (
    typeof value === "object" &&
    value !== null &&
    "safeParse" in value &&
    typeof value.safeParse === "function"
  );
}

type SafeParseResult =
  | { readonly data: unknown; readonly success: true }
  | { readonly success: false };
