/* eslint-disable max-lines, max-lines-per-function -- SDK surface tests intentionally keep public client fixtures together. */
import { describe, expect, it, vi } from "vitest";

import type {
  ApiKeyScope,
  CreateWorkspaceRunInput,
  RunCommandOptions,
  WorkspaceRunsClient,
} from "../index";
import { ApiKeyScopes, createCrowNestClient } from "../index";

describe("SDK surface", () => {
  registerFactoryTests();
  registerSandboxCodeHandleTests();
  registerSandboxCommandHandleTests();
  registerSandboxFileArtifactHandleTests();
  registerDirectFileArtifactClientTests();
  registerCommandCollectTests();
  registerCommandClientTests();
  registerWorkspaceRunTypeSurfaceTests();
});

function registerFactoryTests() {
  it("exposes the canonical CrowNest client factory", () => {
    const client = createCrowNestClient({ apiKey: "cnk_test_key" });

    expect(typeof client.apiKeys.list).toBe("function");
    expect(typeof client.apiKeys.get).toBe("function");
    expect(typeof client.apiKeys.revoke).toBe("function");
    expect(typeof client.code.runStream).toBe("function");
    expect(typeof client.code.listContexts).toBe("function");
    expect(typeof client.projects.create).toBe("function");
    expect(typeof client.sandboxes.create).toBe("function");
    expect(typeof client.sandboxes.setTtl).toBe("function");
    expect("extend" in client.sandboxes).toBe(false);
    expect("start" in client.commands).toBe(false);
    expect(typeof client.sandboxes.get).toBe("function");
    expect(typeof client.usage).toBe("function");
    expect(ApiKeyScopes).toContain("workspace_run:create");

    const scope: ApiKeyScope = "workspace_run:read";
    expect(scope).toBe("workspace_run:read");
  });

  it("rejects collection options for background commands at the type level", () => {
    const background: RunCommandOptions = { background: true };
    // @ts-expect-error Background commands cannot collect artifacts.
    const invalid: RunCommandOptions = {
      background: true,
      collect: [{ path: "/workspace/output.txt" }],
    };

    expect(background.background).toBe(true);
    expect(invalid.background).toBe(true);
  });

  it("exposes CRUD completion helpers on root clients and sandbox handles", async () => {
    const context = {
      createdAt: "2026-06-09T15:30:00.000Z",
      cwd: "/workspace",
      id: "cctx_123",
      language: "python",
      sandboxId: "sbx_123",
    };
    const apiKey = {
      createdAt: "2026-06-09T15:30:00.000Z",
      createdByUserId: "usr_123",
      id: "key_123",
      last4: "test",
      name: "Manager",
      orgId: "org_123",
      prefix: "cn_live_test",
      scopes: ["api_key:read", "api_key:revoke"],
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ data: [apiKey], hasMore: false }))
      .mockResolvedValueOnce(jsonResponse({ apiKey }))
      .mockResolvedValueOnce(
        jsonResponse({
          apiKey: { ...apiKey, revokedAt: "2026-06-09T16:00:00.000Z" },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          project: {
            createdAt: "2026-06-09T15:30:00.000Z",
            id: "prj_created",
            name: "Agent Workspace",
            orgId: "org_123",
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: [context], hasMore: false }))
      .mockResolvedValueOnce(jsonResponse({ context }))
      .mockResolvedValueOnce(sandboxResponse())
      .mockResolvedValueOnce(jsonResponse({ data: [context], hasMore: false }))
      .mockResolvedValueOnce(jsonResponse({ context }));
    const client = createCrowNestClient({
      apiKey: "cn_live_test",
      baseUrl: "https://api.test",
      fetch: fetchMock,
    });

    await expect(client.apiKeys.list()).resolves.toEqual({
      data: [apiKey],
      hasMore: false,
    });
    await expect(client.apiKeys.get("key_123")).resolves.toEqual(apiKey);
    await expect(client.apiKeys.revoke("key_123")).resolves.toMatchObject({
      revokedAt: "2026-06-09T16:00:00.000Z",
    });
    await expect(
      client.projects.create({ name: "Agent Workspace" }),
    ).resolves.toMatchObject({ id: "prj_created" });
    await expect(client.code.listContexts("sbx_123")).resolves.toEqual({
      data: [context],
      hasMore: false,
    });
    await expect(client.code.getContext("sbx_123", "cctx_123")).resolves.toEqual(
      context,
    );

    const sandbox = await client.sandboxes.get("sbx_123");
    await expect(sandbox.code.listContexts()).resolves.toEqual({
      data: [context],
      hasMore: false,
    });
    await expect(sandbox.code.getContext("cctx_123")).resolves.toEqual(context);

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "https://api.test/v1/api-keys",
      "https://api.test/v1/api-keys/key_123",
      "https://api.test/v1/api-keys/key_123",
      "https://api.test/v1/projects",
      "https://api.test/v1/sandboxes/sbx_123/code/contexts",
      "https://api.test/v1/sandboxes/sbx_123/code/contexts/cctx_123",
      "https://api.test/v1/sandboxes/sbx_123",
      "https://api.test/v1/sandboxes/sbx_123/code/contexts",
      "https://api.test/v1/sandboxes/sbx_123/code/contexts/cctx_123",
    ]);
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({ method: "DELETE" });
    expect(fetchMock.mock.calls[3]?.[1]).toMatchObject({
      body: JSON.stringify({ name: "Agent Workspace" }),
      method: "POST",
    });
  });

  it("returns sandbox handles from list and kill helpers", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [sandboxBody()],
          hasMore: false,
        }),
      )
      .mockResolvedValueOnce(sandboxResponse({ status: "destroyed" }));
    const client = createCrowNestClient({
      apiKey: "cn_live_test",
      baseUrl: "https://api.test",
      fetch: fetchMock,
    });

    const listed = await client.sandboxes.list();
    const killed = await client.sandboxes.kill("sbx_123");

    expect(typeof listed.data[0]?.commands.run).toBe("function");
    expect(typeof listed.data[0]?.files.read).toBe("function");
    expect(typeof killed.kill).toBe("function");
    expect(killed.status).toBe("destroyed");
  });
}

function registerSandboxCodeHandleTests() {
  it("exposes sandbox code helpers with language options and streaming", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(sandboxResponse())
      .mockResolvedValueOnce(
        jsonResponse({
          context: {
            createdAt: "2026-06-09T15:30:00.000Z",
            cwd: "/workspace",
            id: "cctx_123",
            language: "typescript",
            sandboxId: "sbx_123",
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          run: {
            contextId: "cctx_123",
            executionCount: 1,
            language: "javascript",
            outputs: [],
            sandboxId: "sbx_123",
            stderr: "",
            stdout: "1\n",
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response('event: stdout\ndata: {"type":"stdout","data":"ready\\n"}\n\n', {
          headers: { "content-type": "text/event-stream" },
        }),
      );
    const client = createCrowNestClient({
      apiKey: "cn_live_test",
      baseUrl: "https://api.test",
      fetch: fetchMock,
    });

    const sandbox = await client.sandboxes.get("sbx_123");
    await expect(
      sandbox.code.createContext({ language: "typescript" }),
    ).resolves.toMatchObject({ language: "typescript" });
    await expect(
      sandbox.code.run({ code: "1", language: "javascript" }),
    ).resolves.toMatchObject({ language: "javascript" });

    const events = [];
    for await (const event of sandbox.code.runStream({
      code: "print('ready')",
      idempotencyKey: "code-stream-key",
      language: "python",
    })) {
      events.push(event);
    }

    expect(events).toEqual([{ data: "ready\n", type: "stdout" }]);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://api.test/v1/sandboxes/sbx_123/code/contexts",
      expect.objectContaining({
        body: JSON.stringify({ language: "typescript" }),
        method: "POST",
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "https://api.test/v1/sandboxes/sbx_123/code/runs",
      expect.objectContaining({
        body: JSON.stringify({ language: "javascript", code: "1" }),
        method: "POST",
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "https://api.test/v1/sandboxes/sbx_123/code/runs/stream",
      expect.objectContaining({
        body: JSON.stringify({ language: "python", code: "print('ready')" }),
        method: "POST",
      }),
    );
    const streamHeaders = fetchMock.mock.calls[3]?.[1]?.headers;
    expect(streamHeaders).toBeInstanceOf(Headers);
    expect((streamHeaders as Headers).get("idempotency-key")).toBe("code-stream-key");
  });

  it("streams code through the direct client without reading the sandbox first", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response('event: stdout\ndata: {"type":"stdout","data":"ready\\n"}\n\n', {
        headers: { "content-type": "text/event-stream" },
      }),
    );
    const client = createCrowNestClient({
      apiKey: "cn_live_test",
      baseUrl: "https://api.test",
      fetch: fetchMock,
    });

    const events = [];
    for await (const event of client.code.runStream("sbx_123", {
      code: "print('ready')",
      idempotencyKey: "direct-code-stream-key",
      language: "python",
    })) {
      events.push(event);
    }

    expect(events).toEqual([{ data: "ready\n", type: "stdout" }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.test/v1/sandboxes/sbx_123/code/runs/stream",
      expect.objectContaining({
        body: JSON.stringify({ language: "python", code: "print('ready')" }),
        method: "POST",
      }),
    );
    const streamHeaders = fetchMock.mock.calls[0]?.[1]?.headers;
    expect(streamHeaders).toBeInstanceOf(Headers);
    expect((streamHeaders as Headers).get("idempotency-key")).toBe(
      "direct-code-stream-key",
    );
  });
}

function registerWorkspaceRunTypeSurfaceTests() {
  it("exposes Workspace Run SDK helpers", async () => {
    const workspaceRun = workspaceRunBody();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ workspaceRun }))
      .mockResolvedValueOnce(
        jsonResponse({
          archive: { sha256: "abc", sizeBytes: 3 },
          workspaceRun: { ...workspaceRun, status: "archive_uploaded" },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          transfer: {
            checksumAlgorithm: "sha256",
            expiresAt: "2026-06-17T12:10:00.000Z",
            headers: { "x-upload-token": "upload-token" },
            id: "upl_test",
            maxSizeBytes: 1_000,
            method: "PUT",
            status: "pending",
            uploadUrl: "https://uploads.test/wsr_test/upl_test",
            workspaceRunId: "wsr_test",
          },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        jsonResponse({
          archive: { sha256: "abc", sizeBytes: 3 },
          workspaceRun: { ...workspaceRun, status: "archive_uploaded" },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ workspaceRun: { ...workspaceRun, status: "running" } }),
      )
      .mockResolvedValueOnce(jsonResponse({ workspaceRun }))
      .mockResolvedValueOnce(jsonResponse({ data: [workspaceRun], hasMore: false }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              createdAt: "2026-06-17T12:00:00.500Z",
              seq: 10,
              type: "log",
              line: "install complete",
              stream: "stdout",
            },
          ],
          hasMore: true,
          nextSeq: 11,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          'event: status\ndata: {"type":"status","seq":1,"status":"running","createdAt":"2026-06-17T12:00:01.000Z"}\n\n',
          { headers: { "content-type": "text/event-stream" } },
        ),
      )
      .mockResolvedValueOnce(jsonResponse({ workspaceRun }))
      .mockResolvedValueOnce(jsonResponse({ evidence: workspaceRunEvidenceBody() }));
    const input: CreateWorkspaceRunInput = {
      artifacts: [{ path: "coverage/lcov.info" }],
      command: "pnpm test",
      idempotencyKey: "workspace-run-create",
      keepSandbox: true,
      metadata: { agent: "crabbox" },
      sourceMetadata: { branch: "main", dirty: "true" },
      template: "python-node",
    };
    const client = createCrowNestClient({
      apiKey: "cn_live_test",
      baseUrl: "https://api.test",
      fetch: fetchMock,
    });
    const typedClient: WorkspaceRunsClient = client.workspaceRuns;

    await expect(typedClient.create(input)).resolves.toMatchObject({
      id: "wsr_test",
    });
    await expect(
      typedClient.uploadArchive("wsr_test", {
        bytes: new Uint8Array([31, 139, 8]),
        idempotencyKey: "upload-key",
        sha256: "abc",
        sizeBytes: 3,
      }),
    ).resolves.toMatchObject({ archive: { sha256: "abc" } });
    const transfer = await typedClient.createArchiveTransfer("wsr_test", {
      idempotencyKey: "transfer-key",
      sha256: "abc",
      sizeBytes: 3,
    });
    await expect(
      typedClient.uploadArchiveToTransfer(transfer, {
        body: new Uint8Array([31, 139, 8]),
      }),
    ).resolves.toBeUndefined();
    await expect(
      typedClient.finalizeArchive("wsr_test", {
        idempotencyKey: "finalize-key",
        sha256: "abc",
        sizeBytes: 3,
        uploadId: "upl_test",
      }),
    ).resolves.toMatchObject({ workspaceRun: { status: "archive_uploaded" } });
    await expect(
      typedClient.start("wsr_test", { idempotencyKey: "start-key" }),
    ).resolves.toMatchObject({ status: "running" });
    await expect(typedClient.get("wsr_test")).resolves.toMatchObject({
      id: "wsr_test",
    });
    await expect(
      typedClient.list({
        limit: 25,
        metadata: { agent: "crabbox" },
        projectId: "prj_test",
        status: "running",
      }),
    ).resolves.toMatchObject({ data: [{ id: "wsr_test" }], hasMore: false });
    await expect(
      typedClient.listEvents("wsr_test", { afterSeq: 9, limit: 2 }),
    ).resolves.toMatchObject({
      data: [{ seq: 10, type: "log" }],
      hasMore: true,
      nextSeq: 11,
    });

    const events = [];
    for await (const event of typedClient.streamEvents("wsr_test", {
      afterSeq: 9,
      reconnect: false,
    })) {
      events.push(event);
    }
    await expect(typedClient.cancel("wsr_test")).resolves.toMatchObject({
      id: "wsr_test",
    });
    await expect(typedClient.evidence("wsr_test")).resolves.toMatchObject({
      workspaceRunId: "wsr_test",
    });

    expect(events).toEqual([
      {
        createdAt: "2026-06-17T12:00:01.000Z",
        seq: 1,
        status: "running",
        type: "status",
      },
    ]);
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "https://api.test/v1/workspace-runs",
      "https://api.test/v1/workspace-runs/wsr_test/archive",
      "https://api.test/v1/workspace-runs/wsr_test/archive-transfer",
      "https://uploads.test/wsr_test/upl_test",
      "https://api.test/v1/workspace-runs/wsr_test/archive/finalize",
      "https://api.test/v1/workspace-runs/wsr_test/start",
      "https://api.test/v1/workspace-runs/wsr_test",
      "https://api.test/v1/workspace-runs?limit=25&projectId=prj_test&status=running&metadata.agent=crabbox",
      "https://api.test/v1/workspace-runs/wsr_test/events?afterSeq=9&limit=2",
      "https://api.test/v1/workspace-runs/wsr_test/events?afterSeq=9&stream=true",
      "https://api.test/v1/workspace-runs/wsr_test/cancel",
      "https://api.test/v1/workspace-runs/wsr_test/evidence",
    ]);
    const directHeaders = fetchMock.mock.calls[1]?.[1]?.headers;
    expect(directHeaders).toBeInstanceOf(Headers);
    expect((directHeaders as Headers).get("content-type")).toBe("application/gzip");
    expect((directHeaders as Headers).get("x-crownest-archive-sha256")).toBe("abc");
    expect((directHeaders as Headers).get("idempotency-key")).toBe("upload-key");
    const stagedHeaders = fetchMock.mock.calls[3]?.[1]?.headers;
    expect(stagedHeaders).toBeInstanceOf(Headers);
    expect((stagedHeaders as Headers).get("authorization")).toBeNull();
    expect((stagedHeaders as Headers).get("x-upload-token")).toBe("upload-token");
  });

  it("runs a Workspace Run archive in one helper call", async () => {
    const workspaceRun = workspaceRunBody();
    const transfer = {
      checksumAlgorithm: "sha256",
      expiresAt: "2026-06-17T12:10:00.000Z",
      headers: { "x-upload-token": "upload-token" },
      id: "upl_test",
      maxSizeBytes: 1_000,
      method: "PUT",
      status: "pending",
      uploadUrl: "https://uploads.test/wsr_test/upl_test",
      workspaceRunId: "wsr_test",
    } as const;
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ workspaceRun }))
      .mockResolvedValueOnce(jsonResponse({ transfer }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        jsonResponse({
          archive: { sha256: "abc", sizeBytes: 3 },
          workspaceRun: { ...workspaceRun, status: "archive_uploaded" },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ workspaceRun: { ...workspaceRun, status: "running" } }),
      );
    const client = createCrowNestClient({
      apiKey: "cn_live_test",
      baseUrl: "https://api.test",
      fetch: fetchMock,
    });
    const runArchive = Reflect.get(client.workspaceRuns, "runArchive");

    await expect(
      runArchive({
        archive: {
          body: new Uint8Array([31, 139, 8]),
          headers: { "content-length": "3" },
          sha256: "abc",
          sizeBytes: 3,
        },
        command: "pnpm test",
        template: "python-node",
      }),
    ).resolves.toMatchObject({ id: "wsr_test", status: "running" });

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "https://api.test/v1/workspace-runs",
      "https://api.test/v1/workspace-runs/wsr_test/archive-transfer",
      "https://uploads.test/wsr_test/upl_test",
      "https://api.test/v1/workspace-runs/wsr_test/archive/finalize",
      "https://api.test/v1/workspace-runs/wsr_test/start",
    ]);
    const uploadHeaders = fetchMock.mock.calls[2]?.[1]?.headers;
    expect(uploadHeaders).toBeInstanceOf(Headers);
    expect((uploadHeaders as Headers).get("content-length")).toBe("3");
    expect((uploadHeaders as Headers).get("x-upload-token")).toBe("upload-token");
  });

  it("waits until a Workspace Run reaches a terminal status", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ workspaceRun: workspaceRunBody({ status: "running" }) }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ workspaceRun: workspaceRunBody({ status: "succeeded" }) }),
      );
    const client = createCrowNestClient({
      apiKey: "cn_live_test",
      baseUrl: "https://api.test",
      fetch: fetchMock,
    });

    await expect(
      client.workspaceRuns.waitUntilDone("wsr_test", {
        intervalMs: 0,
        timeoutMs: 1_000,
      }),
    ).resolves.toMatchObject({ status: "succeeded" });
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "https://api.test/v1/workspace-runs/wsr_test",
      "https://api.test/v1/workspace-runs/wsr_test",
    ]);
  });

  it("authenticates same-origin Workspace Run archive transfer targets only", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = createCrowNestClient({
      apiKey: "cn_live_test",
      baseUrl: "https://api.test",
      fetch: fetchMock,
    });
    const transfer = {
      checksumAlgorithm: "sha256",
      expiresAt: "2026-06-17T12:10:00.000Z",
      headers: {
        "content-length": "7",
        "content-type": "application/gzip",
      },
      id: "upl_test",
      maxSizeBytes: 1_000,
      method: "PUT",
      status: "pending",
      uploadUrl:
        "https://api.test/v1/workspace-runs/wsr_test/archive-transfer/upl_test",
      workspaceRunId: "wsr_test",
    } as const;

    await expect(
      client.workspaceRuns.uploadArchiveToTransfer(transfer, {
        body: new Blob(["archive"]),
        headers: { "content-length": "7" },
      }),
    ).resolves.toBeUndefined();
    await expect(
      client.workspaceRuns.uploadArchiveToTransfer(
        {
          ...transfer,
          headers: { "x-upload-token": "token" },
          uploadUrl: "https://uploads.test/wsr_test/upl_test",
        },
        { body: new Blob(["archive"]) },
      ),
    ).resolves.toBeUndefined();
    await expect(
      client.workspaceRuns.uploadArchiveToTransfer(
        {
          ...transfer,
          uploadUrl: "https://uploads.test/wsr_test/upl_stream",
        },
        { body: streamFromText("archive") },
      ),
    ).resolves.toBeUndefined();

    const sameOriginHeaders = fetchMock.mock.calls[0]?.[1]?.headers;
    expect(sameOriginHeaders).toBeInstanceOf(Headers);
    expect((sameOriginHeaders as Headers).get("authorization")).toBe(
      "Bearer cn_live_test",
    );
    expect((sameOriginHeaders as Headers).get("content-type")).toBe("application/gzip");
    expect((sameOriginHeaders as Headers).get("content-length")).toBe("7");
    const externalHeaders = fetchMock.mock.calls[1]?.[1]?.headers;
    expect(externalHeaders).toBeInstanceOf(Headers);
    expect((externalHeaders as Headers).get("authorization")).toBeNull();
    expect((externalHeaders as Headers).get("x-upload-token")).toBe("token");
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({ duplex: "half" });
  });
}

function streamFromText(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

function registerSandboxCommandHandleTests() {
  it("creates sandbox handles that can run commands", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(sandboxResponse())
      .mockResolvedValueOnce(
        sandboxResponse({
          expiresAt: "2026-06-09T16:00:00.000Z",
          ttlMs: 5_400_000,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          command: {
            command: "python main.py",
            cwd: "/workspace",
            env: {},
            exitCode: 0,
            id: "cmd_123",
            sandboxId: "sbx_123",
            status: "exited",
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          command: {
            cancelMode: "force",
            command: "python main.py",
            cwd: "/workspace",
            env: {},
            id: "cmd_123",
            sandboxId: "sbx_123",
            status: "canceled",
          },
        }),
      );
    const client = createCrowNestClient({
      apiKey: "cn_live_test",
      baseUrl: "https://api.test",
      fetch: fetchMock,
    });

    const sandbox = await client.sandboxes.create({ projectId: "prj_123" });
    expect("extend" in sandbox).toBe(false);
    expect("start" in sandbox.commands).toBe(false);
    expect(typeof sandbox.setTtl).toBe("function");
    const ttlUpdated = await sandbox.setTtl({
      idempotencyKey: "set-ttl-key",
      ttlMs: 5_400_000,
    });
    const command = await ttlUpdated.commands.run("python main.py");
    const canceled = await ttlUpdated.commands.cancel("cmd_123", { mode: "force" });

    expect(sandbox.id).toBe("sbx_123");
    expect(ttlUpdated.ttlMs).toBe(5_400_000);
    expect(command.id).toBe("cmd_123");
    expect(canceled.status).toBe("canceled");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.test/v1/sandboxes",
      expect.objectContaining({
        body: JSON.stringify({ projectId: "prj_123" }),
        method: "POST",
      }),
    );
    const createHeaders = fetchMock.mock.calls[0]?.[1]?.headers;
    expect(createHeaders).toBeInstanceOf(Headers);
    expect((createHeaders as Headers).get("authorization")).toBe("Bearer cn_live_test");
    expect((createHeaders as Headers).get("idempotency-key")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.test/v1/sandboxes/sbx_123/ttl",
      expect.objectContaining({
        body: JSON.stringify({ ttlMs: 5_400_000 }),
        method: "POST",
      }),
    );
    const setTtlHeaders = fetchMock.mock.calls[1]?.[1]?.headers;
    expect(setTtlHeaders).toBeInstanceOf(Headers);
    expect((setTtlHeaders as Headers).get("idempotency-key")).toBe("set-ttl-key");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.test/v1/commands/cmd_123/cancel",
      expect.objectContaining({
        body: JSON.stringify({ mode: "force" }),
        method: "POST",
      }),
    );
  });

  it("exposes command get, logs, and stream helpers on sandbox handles", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(sandboxResponse())
      .mockResolvedValueOnce(commandResponse("running"))
      .mockResolvedValueOnce(commandLogsResponse())
      .mockResolvedValueOnce(commandStreamResponse());
    const client = createCrowNestClient({
      apiKey: "cn_live_test",
      baseUrl: "https://api.test",
      fetch: fetchMock,
    });
    const sandbox = await client.sandboxes.get("sbx_123");

    await expect(sandbox.commands.get("cmd_123")).resolves.toMatchObject({
      id: "cmd_123",
    });
    await expect(sandbox.commands.logs("cmd_123")).resolves.toMatchObject({
      data: [{ seq: 1 }],
    });

    const events = [];
    for await (const event of sandbox.commands.streamLogs("cmd_123", {
      reconnect: false,
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      {
        createdAt: "2026-06-09T15:30:00.000Z",
        data: "ready\n",
        seq: 1,
        stream: "stdout",
        type: "log",
      },
    ]);
  });

  it("waits until a sandbox handle is ready", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(sandboxResponse({ status: "creating" }))
      .mockResolvedValueOnce(sandboxResponse({ status: "ready" }));
    const client = createCrowNestClient({
      apiKey: "cn_live_test",
      baseUrl: "https://api.test",
      fetch: fetchMock,
    });
    const sandbox = await client.sandboxes.get("sbx_123");

    await expect(
      sandbox.waitUntilReady({ intervalMs: 0, timeoutMs: 1_000 }),
    ).resolves.toMatchObject({ status: "ready" });
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "https://api.test/v1/sandboxes/sbx_123",
      "https://api.test/v1/sandboxes/sbx_123",
    ]);
  });
}

function registerSandboxFileArtifactHandleTests() {
  it("exposes file and artifact helpers on sandbox handles", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(sandboxResponse())
      .mockResolvedValueOnce(
        jsonResponse({
          file: { path: "/workspace/input.txt", sizeBytes: 5, type: "file" },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ content: "hello", encoding: "utf8" }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              name: "input.txt",
              path: "/workspace/input.txt",
              sizeBytes: 5,
              type: "file",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ artifact: artifactResponseBody() }))
      .mockResolvedValueOnce(
        jsonResponse({ data: [artifactResponseBody()], hasMore: false }),
      )
      .mockResolvedValueOnce(jsonResponse({ artifact: artifactResponseBody() }))
      .mockResolvedValueOnce(
        jsonResponse({
          authMode: "api_key",
          headers: { "x-content-type-options": "nosniff" },
          method: "GET",
          url: "https://api.test/v1/artifacts/art_123/download",
        }),
      );
    fetchMock
      .mockResolvedValueOnce(new Response("hello"))
      .mockResolvedValueOnce(jsonResponse({ artifact: artifactResponseBody() }))
      .mockResolvedValueOnce(
        jsonResponse({
          authMode: "api_key",
          headers: { "x-content-type-options": "nosniff" },
          method: "GET",
          url: "https://api.test/v1/artifacts/art_123/download",
        }),
      );
    fetchMock.mockResolvedValueOnce(new Response("hello"));
    const client = createCrowNestClient({
      apiKey: "cn_live_test",
      baseUrl: "https://api.test",
      fetch: fetchMock,
    });

    const sandbox = await client.sandboxes.get("sbx_123");
    await expect(
      sandbox.files.write("/workspace/input.txt", "hello"),
    ).resolves.toMatchObject({ path: "/workspace/input.txt" });
    await expect(sandbox.files.read("/workspace/input.txt")).resolves.toBe("hello");
    await expect(sandbox.files.list()).resolves.toMatchObject({
      data: [{ path: "/workspace/input.txt" }],
    });
    await expect(
      sandbox.artifacts.create({ path: "/workspace/input.txt" }),
    ).resolves.toMatchObject({ id: "art_123" });
    await expect(sandbox.artifacts.list()).resolves.toMatchObject({
      data: [{ id: "art_123" }],
      hasMore: false,
    });
    await expect(sandbox.artifacts.get("art_123")).resolves.toMatchObject({
      id: "art_123",
    });
    await expect(sandbox.artifacts.downloadUrl("art_123")).resolves.toMatchObject({
      method: "GET",
    });
    await expect(sandbox.artifacts.download("art_123")).resolves.toEqual(
      new TextEncoder().encode("hello"),
    );
    await expect(sandbox.artifacts.delete("art_123")).resolves.toMatchObject({
      id: "art_123",
    });
    await expect(client.artifacts.downloadUrl("art_123")).resolves.toMatchObject({
      method: "GET",
    });
    await expect(client.artifacts.download("art_123")).resolves.toEqual(
      new TextEncoder().encode("hello"),
    );
  });
}

function registerDirectFileArtifactClientTests() {
  it("exposes direct file and artifact helpers without fetching sandboxes", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          file: { path: "/workspace/input.txt", sizeBytes: 5, type: "file" },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ artifact: artifactResponseBody() }));
    const client = createCrowNestClient({
      apiKey: "cn_live_test",
      baseUrl: "https://api.test",
      fetch: fetchMock,
    });

    await expect(
      client.files.write("sbx_123", "/workspace/input.txt", "hello"),
    ).resolves.toMatchObject({ path: "/workspace/input.txt" });
    await expect(
      client.artifacts.create("sbx_123", { path: "/workspace/input.txt" }),
    ).resolves.toMatchObject({ id: "art_123" });

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "https://api.test/v1/sandboxes/sbx_123/files",
      "https://api.test/v1/sandboxes/sbx_123/artifacts",
    ]);
  });

  it("preserves mounted base URL paths for direct downloads", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("hello"));
    const client = createCrowNestClient({
      apiKey: "cn_live_test",
      baseUrl: "https://api.test/crownest",
      fetch: fetchMock,
    });

    await expect(client.artifacts.download("art_123")).resolves.toEqual(
      new TextEncoder().encode("hello"),
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.test/crownest/v1/artifacts/art_123/download",
      expect.objectContaining({ method: "GET" }),
    );
  });
}

function registerCommandCollectTests() {
  it("passes command collection options through top-level run helpers", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        command: {
          collectStatus: "pending",
          command: "python script.py",
          cwd: "/workspace",
          env: {},
          id: "cmd_123",
          sandboxId: "sbx_123",
          status: "running",
        },
      }),
    );
    const client = createCrowNestClient({
      apiKey: "cn_live_test",
      baseUrl: "https://api.test",
      fetch: fetchMock,
    });

    await client.commands.run("sbx_123", "python script.py", {
      collect: [{ name: "output.csv", path: "/workspace/output.csv" }],
      collectOn: "always",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.test/v1/sandboxes/sbx_123/commands",
      expect.objectContaining({
        body: JSON.stringify({
          command: "python script.py",
          collect: [{ name: "output.csv", path: "/workspace/output.csv" }],
          collectOn: "always",
        }),
        method: "POST",
      }),
    );
  });
}

function registerCommandClientTests() {
  it("exposes top-level command polling, cancel, logs, and stream helpers", async () => {
    const fetchMock = commandFetchMock();
    const client = createCrowNestClient({
      apiKey: "cn_live_test",
      baseUrl: "https://api.test",
      fetch: fetchMock,
    });

    await expect(client.commands.get("cmd_123")).resolves.toMatchObject({
      id: "cmd_123",
      status: "running",
    });
    await expect(
      client.commands.cancel("cmd_123", { mode: "force" }),
    ).resolves.toMatchObject({ cancelMode: "force", status: "canceled" });
    await expect(client.commands.logs("cmd_123")).resolves.toEqual({
      data: [
        {
          commandId: "cmd_123",
          createdAt: "2026-06-09T15:30:00.000Z",
          data: "ready\n",
          seq: 1,
          stream: "stdout",
        },
      ],
      hasMore: false,
    });

    const events = [];
    for await (const event of client.commands.streamLogs("cmd_123", {
      reconnect: false,
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      {
        createdAt: "2026-06-09T15:30:00.000Z",
        data: "ready\n",
        seq: 1,
        stream: "stdout",
        type: "log",
      },
    ]);
  });

  it("aborts command log streams when consumers stop iterating early", async () => {
    const streamCancel = vi.fn();
    let signal: AbortSignal | undefined;
    const body = new ReadableStream<Uint8Array>({
      cancel: streamCancel,
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'id: 1\nevent: log\ndata: {"type":"log","seq":1,"stream":"stdout","data":"ready\\n","createdAt":"2026-06-09T15:30:00.000Z"}\n\n',
          ),
        );
      },
    });
    const fetchMock = vi.fn<typeof fetch>().mockImplementation((_url, init) => {
      signal = init?.signal as AbortSignal | undefined;
      return Promise.resolve(
        new Response(body, { headers: { "content-type": "text/event-stream" } }),
      );
    });
    const client = createCrowNestClient({
      apiKey: "cn_live_test",
      baseUrl: "https://api.test",
      fetch: fetchMock,
    });
    const iterator = client.commands.streamLogs("cmd_123")[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: {
        data: "ready\n",
        seq: 1,
        type: "log",
      },
    });
    await iterator.return?.();

    expect(streamCancel).toHaveBeenCalledTimes(1);
    expect(signal?.aborted).toBe(true);
  });
}

function commandFetchMock() {
  return vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(commandResponse("running"))
    .mockResolvedValueOnce(commandResponse("canceled", { cancelMode: "force" }))
    .mockResolvedValueOnce(commandLogsResponse())
    .mockResolvedValueOnce(commandStreamResponse());
}

function sandboxResponse(overrides: Record<string, unknown> = {}): Response {
  return jsonResponse({
    sandbox: sandboxBody(overrides),
  });
}

function sandboxBody(overrides: Record<string, unknown> = {}) {
  return {
    expiresAt: "2026-06-09T15:30:00.000Z",
    id: "sbx_123",
    metadata: {},
    orgId: "org_123",
    projectId: "prj_123",
    status: "ready",
    templateId: "tpl_python_node",
    templateSlug: "python-node",
    templateVersion: "2026-06-01",
    templateVersionId: "tplv_123",
    ttlMs: 3_600_000,
    ...overrides,
  };
}

function artifactResponseBody() {
  return {
    createdAt: "2026-06-09T15:30:00.000Z",
    id: "art_123",
    name: "input.txt",
    objectKey: "orgs/org_123/projects/prj_123/objects/obj_123",
    orgId: "org_123",
    projectId: "prj_123",
    sandboxId: "sbx_123",
    sizeBytes: 5,
  };
}

function workspaceRunBody(overrides: Record<string, unknown> = {}) {
  return {
    command: "pnpm test",
    createdAt: "2026-06-17T12:00:00.000Z",
    id: "wsr_test",
    keepSandbox: true,
    metadata: {},
    orgId: "org_test",
    projectId: "prj_test",
    status: "awaiting_archive",
    templateId: "tpl_python_node",
    templateSlug: "python-node",
    templateVersion: "2026-06-17",
    templateVersionId: "tplv_python_node",
    ...overrides,
  };
}

function workspaceRunEvidenceBody() {
  return {
    artifactErrors: [],
    artifactIds: [],
    cleanupStatus: "succeeded",
    command: "pnpm test",
    createdAt: "2026-06-17T12:00:00.000Z",
    envKeys: [],
    metadata: {},
    orchestrationSucceeded: true,
    orgId: "org_test",
    projectId: "prj_test",
    status: "succeeded",
    workspaceRunId: "wsr_test",
  };
}

function commandResponse(
  status: "canceled" | "running",
  extras: Record<string, unknown> = {},
): Response {
  return jsonResponse({
    command: {
      command: "npm run dev",
      cwd: "/workspace",
      env: {},
      id: "cmd_123",
      sandboxId: "sbx_123",
      status,
      ...extras,
    },
  });
}

function commandLogsResponse(): Response {
  return jsonResponse({
    data: [
      {
        commandId: "cmd_123",
        createdAt: "2026-06-09T15:30:00.000Z",
        data: "ready\n",
        seq: 1,
        stream: "stdout",
      },
    ],
    hasMore: false,
  });
}

function commandStreamResponse(): Response {
  return new Response(
    'id: 1\nevent: log\ndata: {"type":"log","seq":1,"stream":"stdout","data":"ready\\n","createdAt":"2026-06-09T15:30:00.000Z"}\n\n',
    { headers: { "content-type": "text/event-stream" } },
  );
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status: 200,
  });
}

/* eslint-enable max-lines, max-lines-per-function -- End SDK surface fixture exception. */
