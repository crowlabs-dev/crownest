import { describe, expect, it } from "vitest";

import { callTool, createHarness, createSandboxHandle, text } from "./mcp-test-helpers";

describe("Preview tools", () => {
  it("creates, lists, inspects, and revokes Previews", async () => {
    const sandbox = createSandboxHandle("sbx_preview");
    sandbox.mocks.previewCreate.mockResolvedValueOnce({
      preview: preview(),
      previewToken: "prv_token_once",
    });
    sandbox.mocks.previewList.mockResolvedValueOnce({
      data: [preview()],
      hasMore: true,
      nextCursor: "preview_cursor",
    });
    const { client, tools } = createHarness([sandbox]);
    client.mocks.getPreview.mockResolvedValueOnce(preview());
    client.mocks.revokePreview.mockResolvedValueOnce({
      ...preview(),
      revokedAt: "2026-06-12T12:01:00.000Z",
    });

    const created = await callTool(tools, "create_preview", {
      auth_mode: "token",
      port: 3000,
    });
    const list = await callTool(tools, "list_previews", {
      cursor: "preview_input_cursor",
      limit: 50,
    });
    const get = await callTool(tools, "get_preview", {
      preview_id: "prv_123",
    });
    const revoked = await callTool(tools, "revoke_preview", {
      preview_id: "prv_123",
    });

    expect(sandbox.mocks.previewCreate).toHaveBeenCalledWith({
      authMode: "token",
      port: 3000,
    });
    expect(sandbox.mocks.previewList).toHaveBeenCalledWith({
      cursor: "preview_input_cursor",
      limit: 50,
    });
    expect(client.mocks.getPreview).toHaveBeenCalledWith("prv_123");
    expect(client.mocks.revokePreview).toHaveBeenCalledWith("prv_123");
    expect(text(created)).toContain('"preview_token": "prv_token_once"');
    expect(text(list)).toContain('"sandbox_id": "sbx_preview"');
    expect(text(list)).toContain('"has_more": true');
    expect(text(list)).toContain('"next_cursor": "preview_cursor"');
    expect(text(get)).toContain('"preview_id": "prv_123"');
    expect(text(revoked)).toContain('"revoked_at": "2026-06-12T12:01:00.000Z"');
  });
});

describe("Code Context tools", () => {
  it("creates, lists, inspects, and deletes Code Contexts inside a Sandbox", async () => {
    const sandbox = createSandboxHandle("sbx_code_context");
    sandbox.mocks.codeCreateContext.mockResolvedValueOnce(codeContext());
    sandbox.mocks.codeListContexts.mockResolvedValueOnce({
      data: [codeContext()],
      hasMore: true,
      nextCursor: "context_cursor",
    });
    sandbox.mocks.codeGetContext.mockResolvedValueOnce(codeContext());
    sandbox.mocks.codeDeleteContext.mockResolvedValueOnce({
      ...codeContext(),
      deletedAt: "2026-06-12T12:01:00.000Z",
    });
    const { tools } = createHarness([sandbox]);

    const created = await callTool(tools, "create_code_context", {
      cwd: "/workspace/app",
      language: "typescript",
      timeout_ms: 500,
    });
    const list = await callTool(tools, "list_code_contexts", {
      cursor: "context_input_cursor",
      limit: 50,
    });
    const get = await callTool(tools, "get_code_context", {
      code_context_id: "cctx_123",
    });
    const deleted = await callTool(tools, "delete_code_context", {
      code_context_id: "cctx_123",
    });

    expect(sandbox.mocks.codeCreateContext).toHaveBeenCalledWith({
      cwd: "/workspace/app",
      language: "typescript",
      timeoutMs: 500,
    });
    expect(sandbox.mocks.codeListContexts).toHaveBeenCalledWith({
      cursor: "context_input_cursor",
      limit: 50,
    });
    expect(sandbox.mocks.codeGetContext).toHaveBeenCalledWith("cctx_123");
    expect(sandbox.mocks.codeDeleteContext).toHaveBeenCalledWith("cctx_123");
    expect(text(created)).toContain('"code_context_id": "cctx_123"');
    expect(text(list)).toContain('"sandbox_id": "sbx_code_context"');
    expect(text(list)).toContain('"has_more": true');
    expect(text(list)).toContain('"next_cursor": "context_cursor"');
    expect(text(get)).toContain('"code_context_id": "cctx_123"');
    expect(text(deleted)).toContain('"code_context_id": "cctx_123"');
  });
});

describe("API Key tools", () => {
  it("lists, gets, and revokes API Key metadata without exposing secrets", async () => {
    const { client, tools } = createHarness();
    client.mocks.listApiKeys.mockResolvedValueOnce({
      data: [apiKey()],
      hasMore: true,
      nextCursor: "key_cursor",
    });
    client.mocks.getApiKey.mockResolvedValueOnce(apiKey());
    client.mocks.revokeApiKey.mockResolvedValueOnce({
      ...apiKey(),
      revokedAt: "2026-06-12T12:01:00.000Z",
    });

    const list = await callTool(tools, "list_api_keys", {
      cursor: "key_input_cursor",
      limit: 50,
    });
    const get = await callTool(tools, "get_api_key", {
      api_key_id: "key_123",
    });
    const revoked = await callTool(tools, "revoke_api_key", {
      api_key_id: "key_123",
    });

    expect(client.mocks.listApiKeys).toHaveBeenCalledWith({
      cursor: "key_input_cursor",
      limit: 50,
    });
    expect(client.mocks.getApiKey).toHaveBeenCalledWith("key_123");
    expect(client.mocks.revokeApiKey).toHaveBeenCalledWith("key_123");
    expect(text(list)).toContain('"api_key_id": "key_123"');
    expect(text(list)).toContain('"last4": "cdef"');
    expect(text(list)).toContain('"has_more": true');
    expect(text(list)).toContain('"next_cursor": "key_cursor"');
    expect(text(list)).not.toContain("cn_live_secret");
    expect(text(get)).toContain('"api_key_id": "key_123"');
    expect(text(get)).not.toContain("cn_live_secret");
    expect(text(revoked)).toContain('"revoked_at": "2026-06-12T12:01:00.000Z"');
  });
});

describe("Project tools", () => {
  it("creates and lists Projects through the SDK", async () => {
    const { client, tools } = createHarness();
    client.mocks.createProject.mockResolvedValueOnce(project());
    client.mocks.listProjects.mockResolvedValueOnce({
      data: [project()],
      hasMore: true,
      nextCursor: "project_cursor",
    });

    const result = await callTool(tools, "create_project", {
      name: "Agent Workspace",
    });
    const list = await callTool(tools, "list_projects", {
      cursor: "project_input_cursor",
      limit: 50,
    });

    expect(client.mocks.createProject).toHaveBeenCalledWith({
      name: "Agent Workspace",
    });
    expect(client.mocks.listProjects).toHaveBeenCalledWith({
      cursor: "project_input_cursor",
      limit: 50,
    });
    expect(text(result)).toContain('"project_id": "prj_123"');
    expect(text(result)).toContain('"name": "Agent Workspace"');
    expect(text(list)).toContain('"project_id": "prj_123"');
    expect(text(list)).toContain('"has_more": true');
    expect(text(list)).toContain('"next_cursor": "project_cursor"');
  });
});

function preview() {
  return {
    authMode: "token",
    createdAt: "2026-06-12T12:00:00.000Z",
    id: "prv_123",
    orgId: "org_123",
    port: 3000,
    projectId: "prj_123",
    sandboxId: "sbx_preview",
    slug: "p-abc123",
    url: "https://p-abc123.crownest.dev",
  };
}

function codeContext() {
  return {
    createdAt: "2026-06-12T12:00:00.000Z",
    cwd: "/workspace",
    id: "cctx_123",
    isDefault: true,
    language: "python",
    sandboxId: "sbx_code_context",
  };
}

function apiKey() {
  return {
    createdAt: "2026-06-12T12:00:00.000Z",
    createdByUserId: "usr_123",
    id: "key_123",
    last4: "cdef",
    name: "agent",
    orgId: "org_123",
    prefix: "cn_live_ab",
    projectIds: ["prj_123"],
    scopes: ["sandbox:create", "command:run"],
    secret: "cn_live_secret",
  };
}

function project() {
  return {
    createdAt: "2026-06-12T12:00:00.000Z",
    id: "prj_123",
    name: "Agent Workspace",
    orgId: "org_123",
  };
}
