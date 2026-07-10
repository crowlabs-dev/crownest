import { CrowNestApiError } from "@crownest/sdk";
import { describe, expect, it } from "vitest";

import { callTool, createHarness, createSandboxHandle, text } from "./mcp-test-helpers";

describe("Sandbox tools", () => {
  it("creates and kills session Sandboxes", async () => {
    const sandbox = createSandboxHandle("sbx_created");
    const { tools } = createHarness([sandbox]);

    const created = await callTool(tools, "create_sandbox", { ttl_ms: 60_000 });
    const killed = await callTool(tools, "kill_sandbox", {
      sandbox_id: "sbx_created",
    });

    expect(text(created)).toContain('"sandbox_id": "sbx_created"');
    expect(sandbox.mocks.kill).toHaveBeenCalledTimes(1);
    expect(text(killed)).toContain('"killed": true');
  });

  it("does not make create_sandbox the default Sandbox for later tool calls", async () => {
    const explicit = createSandboxHandle("sbx_explicit");
    const defaultSandbox = createSandboxHandle("sbx_default");
    defaultSandbox.mocks.codeRun.mockResolvedValueOnce(codeRunResult("sbx_default"));
    const { client, tools } = createHarness([explicit, defaultSandbox]);

    await callTool(tools, "create_sandbox", {});
    const code = await callTool(tools, "run_code", { code: "print(1)" });

    expect(client.mocks.createSandbox).toHaveBeenCalledTimes(2);
    expect(explicit.mocks.codeRun).not.toHaveBeenCalled();
    expect(defaultSandbox.mocks.codeRun).toHaveBeenCalledWith({
      artifactPolicy: "promote",
      code: "print(1)",
    });
    expect(text(code)).toContain("sandbox_id: sbx_default");
  });

  it("lists, inspects, and extends Sandboxes through the SDK", async () => {
    const listed = [
      sandboxResource("sbx_ready", "ready"),
      sandboxResource("sbx_destroyed", "destroyed"),
    ];
    const inspected = createSandboxHandle("sbx_ready");
    const extended = createSandboxHandle("sbx_extended");
    const { client, tools } = createHarness();
    client.mocks.listSandboxes.mockResolvedValueOnce({
      data: listed,
      hasMore: true,
      nextCursor: "sbx_cursor",
    });
    client.mocks.getSandbox.mockResolvedValueOnce(inspected);
    client.mocks.setSandboxTtl.mockResolvedValueOnce(extended);

    const list = await callTool(tools, "list_sandboxes", {
      cursor: "sandbox_input_cursor",
      limit: 1,
      status: "ready",
    });
    const get = await callTool(tools, "get_sandbox", {
      sandbox_id: "sbx_ready",
    });
    const setTtl = await callTool(tools, "set_sandbox_ttl", {
      sandbox_id: "sbx_ready",
      ttl_ms: 120_000,
    });

    expect(client.mocks.listSandboxes).toHaveBeenCalledWith({
      cursor: "sandbox_input_cursor",
      limit: 1,
    });
    expect(client.mocks.getSandbox).toHaveBeenCalledWith("sbx_ready");
    expect(client.mocks.setSandboxTtl).toHaveBeenCalledWith("sbx_ready", {
      ttlMs: 120_000,
    });
    expect(text(list)).toContain('"sandbox_id": "sbx_ready"');
    expect(text(list)).not.toContain("sbx_destroyed");
    expect(text(list)).toContain('"has_more": true');
    expect(text(list)).toContain('"next_cursor": "sbx_cursor"');
    expect(text(get)).toContain('"template": "python-node@1.0.0"');
    expect(text(setTtl)).toContain('"sandbox_id": "sbx_extended"');
  });
});

describe("Default Sandbox TTL", () => {
  it("sets the lazy default Sandbox TTL through the tracked handle", async () => {
    const sandbox = createSandboxHandle("sbx_default");
    const extended = createSandboxHandle("sbx_default");
    sandbox.mocks.sandboxSetTtl.mockResolvedValueOnce(extended);
    const { client, tools } = createHarness([sandbox]);

    const result = await callTool(tools, "set_sandbox_ttl", {
      ttl_ms: 120_000,
    });

    expect(sandbox.mocks.sandboxSetTtl).toHaveBeenCalledWith({ ttlMs: 120_000 });
    expect(client.mocks.setSandboxTtl).not.toHaveBeenCalled();
    expect(text(result)).toContain('"sandbox_id": "sbx_default"');
  });
});

describe("Sandbox TTL tracking", () => {
  it("refreshes the tracked default Sandbox after an explicit TTL reset", async () => {
    const staleDefault = createSandboxHandle("sbx_default", {
      expiresAt: "1970-01-01T00:00:00.000Z",
    });
    const extendedDefault = createSandboxHandle("sbx_default");
    const fallback = createSandboxHandle("sbx_fallback");
    staleDefault.mocks.codeRun.mockResolvedValueOnce(codeRunResult("sbx_default"));
    extendedDefault.mocks.codeRun.mockResolvedValueOnce(codeRunResult("sbx_default"));
    const { client, tools } = createHarness([staleDefault, fallback]);
    client.mocks.setSandboxTtl.mockResolvedValueOnce(extendedDefault);

    await callTool(tools, "run_code", { code: "print(1)" });
    await callTool(tools, "set_sandbox_ttl", {
      sandbox_id: "sbx_default",
      ttl_ms: 120_000,
    });
    await callTool(tools, "run_code", { code: "print(2)" });

    expect(client.mocks.createSandbox).toHaveBeenCalledTimes(1);
    expect(fallback.mocks.codeRun).not.toHaveBeenCalled();
    expect(extendedDefault.mocks.codeRun).toHaveBeenCalledWith({
      artifactPolicy: "promote",
      code: "print(2)",
    });
  });
});

describe("Artifact tools", () => {
  it("downloads Artifacts as base64 with content type fallback", async () => {
    const sandbox = createSandboxHandle("sbx_default");
    const { client, tools } = createHarness([sandbox]);
    client.mocks.getArtifact.mockResolvedValueOnce(artifact());
    client.mocks.downloadArtifact.mockResolvedValueOnce(new Uint8Array([104, 105]));
    client.mocks.downloadArtifactUrl.mockResolvedValueOnce({
      authMode: "api_key",
      headers: { authorization: "Bearer cn_test" },
      method: "GET",
      url: "https://api.test/artifacts/art_123/download",
    });

    const result = await callTool(tools, "download_artifact", {
      artifact_id: "art_123",
    });
    const url = await callTool(tools, "get_artifact_download_url", {
      artifact_id: "art_123",
    });

    expect(client.mocks.getArtifact).toHaveBeenCalledWith("art_123");
    expect(client.mocks.downloadArtifact).toHaveBeenCalledWith("art_123");
    expect(client.mocks.downloadArtifactUrl).toHaveBeenCalledWith("art_123");
    expect(text(result)).toContain('"content_base64": "aGk="');
    expect(text(result)).toContain('"content_type": "application/octet-stream"');
    expect(text(url)).toContain('"url": "https://api.test/artifacts/art_123/download"');
  });

  it("creates, lists, inspects, and deletes Artifact metadata", async () => {
    const sandbox = createSandboxHandle("sbx_artifacts");
    sandbox.mocks.artifactCreate.mockResolvedValueOnce(artifact());
    sandbox.mocks.artifactList.mockResolvedValueOnce({
      data: [artifact()],
      hasMore: true,
      nextCursor: "artifact_cursor",
    });
    const { client, tools } = createHarness([sandbox]);
    client.mocks.getArtifact.mockResolvedValueOnce(artifact());
    client.mocks.deleteArtifact.mockResolvedValueOnce({
      ...artifact(),
      deletedAt: "2026-06-12T12:01:00.000Z",
    });

    const created = await callTool(tools, "create_artifact", {
      name: "plot.png",
      source_path: "/workspace/plot.png",
    });
    const list = await callTool(tools, "list_artifacts", {
      cursor: "artifact_input_cursor",
      limit: 50,
    });
    const get = await callTool(tools, "get_artifact", {
      artifact_id: "art_123",
    });
    const deleted = await callTool(tools, "delete_artifact", {
      artifact_id: "art_123",
    });

    expect(sandbox.mocks.artifactCreate).toHaveBeenCalledWith({
      name: "plot.png",
      path: "/workspace/plot.png",
    });
    expect(sandbox.mocks.artifactList).toHaveBeenCalledWith({
      cursor: "artifact_input_cursor",
      limit: 50,
    });
    expect(client.mocks.getArtifact).toHaveBeenCalledWith("art_123");
    expect(client.mocks.deleteArtifact).toHaveBeenCalledWith("art_123");
    expect(text(created)).toContain('"artifact_id": "art_123"');
    expect(text(list)).toContain('"sandbox_id": "sbx_artifacts"');
    expect(text(list)).toContain('"has_more": true');
    expect(text(list)).toContain('"next_cursor": "artifact_cursor"');
    expect(text(get)).not.toContain("content_base64");
    expect(text(deleted)).toContain('"artifact_id": "art_123"');
    expect(text(deleted)).toContain('"deleted_at": "2026-06-12T12:01:00.000Z"');
  });
});

describe("Usage tool", () => {
  it("summarizes usage and MCP-session Sandbox state without creating a default", async () => {
    const explicit = createSandboxHandle("sbx_usage");
    const { client, tools } = createHarness([explicit]);
    client.mocks.usage.mockResolvedValueOnce(usageSummary());

    await callTool(tools, "create_sandbox", {});
    const result = await callTool(tools, "get_usage", {});

    expect(client.mocks.usage).toHaveBeenCalledWith();
    expect(client.mocks.createSandbox).toHaveBeenCalledTimes(1);
    expect(text(result)).toContain("compute_unit_seconds_used: 42");
    expect(text(result)).toContain("credits_remaining: 9.5");
    expect(text(result)).toContain("active_sandbox_count: 1");
    expect(text(result)).toContain("sandbox_ids: sbx_usage");
    expect(text(result)).toContain("active_sandboxes: current=1 limit=3");
  });
});

describe("tool error mapping", () => {
  it("maps CrowNest API errors to MCP tool error results", async () => {
    const sandbox = createSandboxHandle("sbx_error");
    sandbox.mocks.commandRun.mockRejectedValueOnce(
      new CrowNestApiError(401, { code: "unauthorized", message: "bad key" }),
    );
    const { tools } = createHarness([sandbox]);

    const result = await callTool(tools, "run_command", { command: "pwd" });

    expect(result.isError).toBe(true);
    expect(error(result)).toMatchObject({
      code: "unauthorized",
      message: "bad key",
      status: 401,
    });
  });

  it("maps unknown Sandbox ids to stable MCP tool errors", async () => {
    const { client, tools } = createHarness();
    client.mocks.getSandbox.mockRejectedValue(
      new CrowNestApiError(404, {
        code: "sandbox_not_found",
        message: "Sandbox not found",
      }),
    );

    const command = await callTool(tools, "run_command", unknownCommandInput());
    const kill = await callTool(tools, "kill_sandbox", unknownKillInput());

    expect(command.isError).toBe(true);
    expect(kill.isError).toBe(true);
    expect(error(command).code).toBe("sandbox_not_found");
    expect(error(kill).code).toBe("sandbox_not_found");
  });

  it("maps non-SDK failures to internal_error without stack traces", async () => {
    const errorSandbox = createSandboxHandle("sbx_error");
    const valueSandbox = createSandboxHandle("sbx_value");
    errorSandbox.mocks.commandRun.mockRejectedValueOnce(new Error("boom"));
    valueSandbox.mocks.commandRun.mockRejectedValueOnce("bad value");
    const { tools } = createHarness([errorSandbox, valueSandbox]);

    await callTool(tools, "create_sandbox", {});
    await callTool(tools, "create_sandbox", {});
    const errorResult = await callTool(tools, "run_command", errorCommandInput());
    const valueResult = await callTool(tools, "run_command", valueCommandInput());

    expect(errorResult.isError).toBe(true);
    expect(valueResult.isError).toBe(true);
    expect(error(errorResult)).toMatchObject({
      code: "internal_error",
      message: "boom",
    });
    expect(error(valueResult)).toMatchObject({
      code: "internal_error",
      message: "bad value",
    });
    expect(text(errorResult)).not.toContain(" at ");
  });
});

function error(result: Parameters<typeof text>[0]) {
  const parsed = JSON.parse(text(result)) as {
    readonly error: {
      readonly code: string;
      readonly message: string;
      readonly status: number | null;
    };
  };
  return parsed.error;
}

function artifact() {
  return {
    createdAt: "2026-06-12T12:00:00.000Z",
    id: "art_123",
    name: "plot.png",
    objectKey: "orgs/org_123/projects/prj_123/objects/obj_123",
    orgId: "org_123",
    projectId: "prj_123",
    sandboxId: "sbx_default",
    sizeBytes: 2,
  };
}

function codeRunResult(sandboxId: `sbx_${string}`) {
  return {
    language: "python",
    outputs: [],
    sandboxId,
    stderr: "",
    stdout: "1",
  };
}

function sandboxResource(id: `sbx_${string}`, status: string) {
  return {
    createdAt: "2026-06-12T12:00:00.000Z",
    expiresAt: "2999-01-01T00:00:00.000Z",
    id,
    metadata: {},
    orgId: "org_123",
    projectId: "prj_123",
    status,
    templateId: "tpl_123",
    templateSlug: "python-node",
    templateVersion: "1.0.0",
    templateVersionId: "tplv_123",
    ttlMs: 60_000,
  };
}

function usageSummary() {
  return {
    computeUnitSeconds: { used: 42 },
    computeUnitSecondsPerCredit: 1_000,
    credits: { remaining: 9.5, used: 0.042 },
    period: {
      end: "2026-07-01T00:00:00.000Z",
      resetAt: "2026-07-01T00:00:00.000Z",
      start: "2026-06-01T00:00:00.000Z",
    },
    pricingVersion: "beta-2026-06",
    quotas: {
      active_sandboxes: {
        current: 1,
        limit: 3,
        remaining: 2,
        resetAt: null,
      },
    },
  };
}

function unknownCommandInput() {
  return { command: "pwd", sandbox_id: "sbx_missing" };
}

function unknownKillInput() {
  return { sandbox_id: "sbx_missing" };
}

function errorCommandInput() {
  return { command: "pwd", sandbox_id: "sbx_error" };
}

function valueCommandInput() {
  return { command: "pwd", sandbox_id: "sbx_value" };
}
