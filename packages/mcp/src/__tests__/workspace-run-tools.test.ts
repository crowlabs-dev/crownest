import { describe, expect, it } from "vitest";

import { callTool, createHarness, text } from "./mcp-test-helpers";

const SHA256 = "a".repeat(64);

describe("Workspace Run tools", () => {
  it("runs the Workspace Run lifecycle through the SDK", async () => {
    const { client, results, transfer } = await runWorkspaceRunLifecycle();

    expectWorkspaceRunSdkCalls(client, transfer);
    expectWorkspaceRunToolResults(results);
  });
});

async function runWorkspaceRunLifecycle() {
  const { client, tools } = createHarness();
  const run = workspaceRun();
  const transfer = archiveTransfer();

  mockWorkspaceRunLifecycle(client, run, transfer);

  return {
    client,
    results: await callWorkspaceRunTools(tools),
    transfer,
  };
}

function mockWorkspaceRunLifecycle(
  client: ReturnType<typeof createHarness>["client"],
  run: ReturnType<typeof workspaceRun>,
  transfer: ReturnType<typeof archiveTransfer>,
): void {
  client.mocks.createWorkspaceRun.mockResolvedValueOnce(run);
  client.mocks.uploadWorkspaceRunArchive.mockResolvedValueOnce({
    archive: archive(),
    workspaceRun: { ...run, status: "archive_uploaded" },
  });
  client.mocks.createWorkspaceRunArchiveTransfer.mockResolvedValueOnce(transfer);
  client.mocks.uploadWorkspaceRunArchiveToTransfer.mockResolvedValueOnce(undefined);
  client.mocks.finalizeWorkspaceRunArchive.mockResolvedValueOnce({
    archive: archive(),
    workspaceRun: { ...run, status: "archive_uploaded" },
  });
  client.mocks.startWorkspaceRun.mockResolvedValueOnce({ ...run, status: "running" });
  client.mocks.getWorkspaceRun.mockResolvedValueOnce(run);
  client.mocks.listWorkspaceRuns.mockResolvedValueOnce({
    data: [run],
    hasMore: true,
    nextCursor: "workspace_run_cursor",
  });
  client.mocks.listWorkspaceRunEvents.mockResolvedValueOnce(workspaceRunEvents());
  client.mocks.cancelWorkspaceRun.mockResolvedValueOnce({
    ...run,
    status: "canceled",
  });
  client.mocks.getWorkspaceRunEvidence.mockResolvedValueOnce(evidence());
}

async function callWorkspaceRunTools(tools: ReturnType<typeof createHarness>["tools"]) {
  return {
    canceled: await callTool(tools, "cancel_workspace_run", {
      workspace_run_id: "wsr_123",
    }),
    created: await callTool(tools, "create_workspace_run", {
      artifacts: [{ name: "coverage", path: "coverage/lcov.info" }],
      command: "pnpm test",
      idempotency_key: "create-run",
      keep_sandbox: true,
      metadata: { agent: "codex" },
      project_id: "prj_123",
      source_metadata: { branch: "main" },
      template: "python-node",
      timeout_ms: 120_000,
    }),
    events: await callTool(tools, "replay_workspace_run_events", {
      after_seq: 1,
      limit: 10,
      workspace_run_id: "wsr_123",
    }),
    evidenceResult: await callTool(tools, "get_workspace_run_evidence", {
      workspace_run_id: "wsr_123",
    }),
    finalized: await callTool(tools, "finalize_workspace_run_archive", {
      idempotency_key: "finalize-run",
      sha256: SHA256,
      size_bytes: 3,
      upload_id: "upl_123",
      workspace_run_id: "wsr_123",
    }),
    get: await callTool(tools, "get_workspace_run", {
      workspace_run_id: "wsr_123",
    }),
    list: await callTool(tools, "list_workspace_runs", {
      cursor: "workspace_run_input_cursor",
      limit: 25,
      metadata: { agent: "codex" },
      project_id: "prj_123",
      status: "running",
    }),
    started: await callTool(tools, "start_workspace_run", {
      idempotency_key: "start-run",
      workspace_run_id: "wsr_123",
    }),
    transferResult: await callTool(tools, "create_workspace_run_archive_transfer", {
      idempotency_key: "transfer-run",
      sha256: SHA256,
      size_bytes: 3,
      workspace_run_id: "wsr_123",
    }),
    transferUpload: await callTool(tools, "upload_workspace_run_archive_transfer", {
      content_base64: "H4sI",
      upload_id: "upl_123",
    }),
    uploaded: await callTool(tools, "upload_workspace_run_archive", {
      content_base64: "H4sI",
      idempotency_key: "upload-run",
      sha256: SHA256,
      size_bytes: 3,
      workspace_run_id: "wsr_123",
    }),
  };
}

function expectWorkspaceRunSdkCalls(
  client: ReturnType<typeof createHarness>["client"],
  transfer: ReturnType<typeof archiveTransfer>,
): void {
  expect(client.mocks.createWorkspaceRun).toHaveBeenCalledWith({
    artifacts: [{ name: "coverage", path: "coverage/lcov.info" }],
    command: "pnpm test",
    idempotencyKey: "create-run",
    keepSandbox: true,
    metadata: { agent: "codex" },
    projectId: "prj_123",
    sourceMetadata: { branch: "main" },
    template: "python-node",
    timeoutMs: 120_000,
  });
  expect(client.mocks.uploadWorkspaceRunArchive).toHaveBeenCalledWith("wsr_123", {
    bytes: Buffer.from("H4sI", "base64"),
    idempotencyKey: "upload-run",
    sha256: SHA256,
    sizeBytes: 3,
  });
  expect(client.mocks.createWorkspaceRunArchiveTransfer).toHaveBeenCalledWith(
    "wsr_123",
    { idempotencyKey: "transfer-run", sha256: SHA256, sizeBytes: 3 },
  );
  expect(client.mocks.uploadWorkspaceRunArchiveToTransfer).toHaveBeenCalledWith(
    transfer,
    { body: Buffer.from("H4sI", "base64") },
  );
  expect(client.mocks.finalizeWorkspaceRunArchive).toHaveBeenCalledWith("wsr_123", {
    idempotencyKey: "finalize-run",
    sha256: SHA256,
    sizeBytes: 3,
    uploadId: "upl_123",
  });
  expect(client.mocks.startWorkspaceRun).toHaveBeenCalledWith("wsr_123", {
    idempotencyKey: "start-run",
  });
  expect(client.mocks.getWorkspaceRun).toHaveBeenCalledWith("wsr_123");
  expect(client.mocks.listWorkspaceRuns).toHaveBeenCalledWith({
    cursor: "workspace_run_input_cursor",
    limit: 25,
    metadata: { agent: "codex" },
    projectId: "prj_123",
    status: "running",
  });
  expect(client.mocks.listWorkspaceRunEvents).toHaveBeenCalledWith("wsr_123", {
    afterSeq: 1,
    limit: 10,
  });
  expect(client.mocks.cancelWorkspaceRun).toHaveBeenCalledWith("wsr_123");
  expect(client.mocks.getWorkspaceRunEvidence).toHaveBeenCalledWith("wsr_123");
}

function expectWorkspaceRunToolResults(
  results: Awaited<ReturnType<typeof callWorkspaceRunTools>>,
): void {
  expect(text(results.created)).toContain('"id": "wsr_123"');
  expect(text(results.uploaded)).toContain('"archive"');
  expect(text(results.transferResult)).toContain('"upload_id": "upl_123"');
  expect(text(results.transferResult)).toContain('"header_names"');
  expect(text(results.transferResult)).not.toContain('"headers"');
  expect(text(results.transferResult)).not.toContain('"upload-token"');
  expect(text(results.transferUpload)).toContain('"uploaded": true');
  expect(text(results.finalized)).toContain('"archive"');
  expect(text(results.started)).toContain('"status": "running"');
  expect(text(results.get)).toContain('"id": "wsr_123"');
  expect(text(results.list)).toContain('"id": "wsr_123"');
  expect(text(results.list)).toContain('"has_more": true');
  expect(text(results.list)).toContain('"next_cursor": "workspace_run_cursor"');
  expect(text(results.events)).toContain('"nextSeq": 2');
  expect(text(results.canceled)).toContain('"status": "canceled"');
  expect(text(results.evidenceResult)).toContain('"workspaceRunId": "wsr_123"');
}

function workspaceRunEvents() {
  return {
    data: [
      {
        createdAt: "2026-06-12T12:00:01.000Z",
        seq: 2,
        status: "running",
        type: "status",
      },
    ],
    hasMore: false,
    nextSeq: 2,
  };
}

function workspaceRun() {
  return {
    command: "pnpm test",
    createdAt: "2026-06-12T12:00:00.000Z",
    id: "wsr_123",
    keepSandbox: true,
    metadata: { agent: "codex" },
    orgId: "org_123",
    projectId: "prj_123",
    status: "awaiting_archive",
    templateId: "tpl_123",
    templateSlug: "python-node",
    templateVersion: "1.0.0",
    templateVersionId: "tplv_123",
  };
}

function archive() {
  return {
    sha256: SHA256,
    sizeBytes: 3,
    uploadedAt: "2026-06-12T12:00:01.000Z",
  };
}

function archiveTransfer() {
  return {
    checksumAlgorithm: "sha256",
    expiresAt: "2026-06-12T12:10:00.000Z",
    headers: { "x-upload-token": "upload-token" },
    id: "upl_123",
    maxSizeBytes: 1_000,
    method: "PUT",
    status: "pending",
    uploadUrl: "https://uploads.test/wsr_123/upl_123",
    workspaceRunId: "wsr_123",
  };
}

function evidence() {
  return {
    artifactErrors: [],
    artifactIds: [],
    cleanupStatus: "succeeded",
    command: "pnpm test",
    createdAt: "2026-06-12T12:00:00.000Z",
    envKeys: [],
    metadata: { agent: "codex" },
    orchestrationSucceeded: true,
    orgId: "org_123",
    projectId: "prj_123",
    status: "succeeded",
    workspaceRunId: "wsr_123",
  };
}
