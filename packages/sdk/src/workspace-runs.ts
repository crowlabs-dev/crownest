/* eslint-disable max-lines-per-function -- Workspace Run methods are kept in one resource client. */

import type {
  CancelWorkspaceRunResponse,
  CreateWorkspaceRunArchiveTransferResponse,
  CreateWorkspaceRunResponse,
  FinalizeWorkspaceRunArchiveResponse,
  GetWorkspaceRunEvidenceResponse,
  GetWorkspaceRunResponse,
  ListWorkspaceRunEventsResponse,
  ListWorkspaceRunsResponse,
  StartWorkspaceRunResponse,
  UploadWorkspaceRunArchiveResponse,
  WorkspaceRunStreamEvent,
} from "@crownest/contracts";

import type {
  ListWorkspaceRunsInput,
  WaitForTerminalInput,
  WorkspaceRunEventsInput,
  WorkspaceRunsClient,
} from "./client-types";
import { createPage, paginationParams } from "./pagination";
import { pollUntil } from "./polling";
import { CrowNestApiError, queryString, type Transport } from "./protocol";

const streamReconnectDelaysMs = [250, 500, 1_000, 2_000, 4_000] as const;
const maxDirectWorkspaceRunArchiveBytes = 8 * 1024 * 1024;

export function createWorkspaceRunsClient(transport: Transport): WorkspaceRunsClient {
  const client: WorkspaceRunsClient = {
    async cancel(workspaceRunId) {
      const response = await transport.request<CancelWorkspaceRunResponse>(
        `/v1/workspace-runs/${workspaceRunId}/cancel`,
        { idempotent: true, method: "POST" },
      );
      return response.workspaceRun;
    },
    async create(input) {
      const { idempotencyKey, ...body } = input;
      const response = await transport.request<CreateWorkspaceRunResponse>(
        "/v1/workspace-runs",
        {
          body,
          ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
          idempotent: true,
          method: "POST",
        },
      );
      return response.workspaceRun;
    },
    async createArchiveTransfer(workspaceRunId, input) {
      const { idempotencyKey, ...body } = input;
      const response =
        await transport.request<CreateWorkspaceRunArchiveTransferResponse>(
          `/v1/workspace-runs/${workspaceRunId}/archive-transfer`,
          {
            body,
            ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
            idempotent: true,
            method: "POST",
          },
        );
      return response.transfer;
    },
    async evidence(workspaceRunId) {
      const response = await transport.request<GetWorkspaceRunEvidenceResponse>(
        `/v1/workspace-runs/${workspaceRunId}/evidence`,
        { method: "GET" },
      );
      return response.evidence;
    },
    async finalizeArchive(workspaceRunId, input) {
      const { idempotencyKey, ...body } = input;
      return transport.request<FinalizeWorkspaceRunArchiveResponse>(
        `/v1/workspace-runs/${workspaceRunId}/archive/finalize`,
        {
          body,
          ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
          idempotent: true,
          method: "POST",
        },
      );
    },
    async get(workspaceRunId) {
      const response = await transport.request<GetWorkspaceRunResponse>(
        `/v1/workspace-runs/${workspaceRunId}`,
        { method: "GET" },
      );
      return response.workspaceRun;
    },
    async list(input = {}) {
      const fetchPage = (cursor = input.cursor) =>
        transport.request<ListWorkspaceRunsResponse>(
          `/v1/workspace-runs${queryString(
            workspaceRunListParams({ ...input, cursor }),
          )}`,
          { method: "GET", signal: input.signal },
        );
      return createPage(await fetchPage(), fetchPage);
    },
    listEvents(workspaceRunId, input = {}) {
      return transport.request<ListWorkspaceRunEventsResponse>(
        `/v1/workspace-runs/${workspaceRunId}/events${queryString(
          workspaceRunEventParams(input),
        )}`,
        { method: "GET" },
      );
    },
    async runArchive(input) {
      const { archive, ...createInput } = input;
      const run = await client.create(createInput);
      const transfer = await client.createArchiveTransfer(run.id, {
        sha256: archive.sha256,
        sizeBytes: archive.sizeBytes,
      });
      await client.uploadArchiveToTransfer(transfer, {
        body: archive.body,
        ...(archive.headers === undefined ? {} : { headers: archive.headers }),
      });
      await client.finalizeArchive(run.id, {
        sha256: archive.sha256,
        sizeBytes: archive.sizeBytes,
        uploadId: transfer.id,
      });
      return client.start(run.id);
    },
    async run(input) {
      const { archive, wait, waitOptions, ...createInput } = input;
      const run = await client.create(createInput);
      if (archive.sizeBytes <= maxDirectWorkspaceRunArchiveBytes) {
        await client.uploadArchive(run.id, {
          bytes: await bodyBytes(archive.body),
          sha256: archive.sha256,
          sizeBytes: archive.sizeBytes,
        });
      } else {
        const transfer = await client.createArchiveTransfer(run.id, {
          sha256: archive.sha256,
          sizeBytes: archive.sizeBytes,
        });
        await client.uploadArchiveToTransfer(transfer, { body: archive.body });
        await client.finalizeArchive(run.id, {
          sha256: archive.sha256,
          sizeBytes: archive.sizeBytes,
          uploadId: transfer.id,
        });
      }
      const started = await client.start(run.id);
      return wait ? client.waitUntilDone(started.id, waitOptions) : started;
    },
    async start(workspaceRunId, input = {}) {
      const { idempotencyKey } = input;
      const response = await transport.request<StartWorkspaceRunResponse>(
        `/v1/workspace-runs/${workspaceRunId}/start`,
        {
          ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
          idempotent: true,
          method: "POST",
        },
      );
      return response.workspaceRun;
    },
    streamEvents(workspaceRunId, input = {}) {
      return streamWorkspaceRunEvents(transport, workspaceRunId, input);
    },
    waitUntilDone(workspaceRunId, input = {}) {
      return waitUntilWorkspaceRunDone(transport, workspaceRunId, input);
    },
    async uploadArchive(workspaceRunId, input) {
      const { bytes, idempotencyKey, sha256, sizeBytes } = input;
      const response = await transport.raw(
        `/v1/workspace-runs/${workspaceRunId}/archive`,
        {
          body: bodyFromBytes(bytes),
          headers: archiveHeaders({ sha256, sizeBytes }),
          ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
          idempotent: true,
          method: "PUT",
        },
      );
      return (await response.json()) as UploadWorkspaceRunArchiveResponse;
    },
    async uploadArchiveToTransfer(transfer, input) {
      const headers = new Headers(transfer.headers);
      for (const [name, value] of new Headers(input.headers)) {
        headers.set(name, value);
      }
      await transport.raw(transfer.uploadUrl, {
        apiError: false,
        auth: "same-origin",
        body: input.body,
        headers,
        method: "PUT",
      });
    },
  };
  return client;
}

async function waitUntilWorkspaceRunDone(
  transport: Transport,
  workspaceRunId: `wsr_${string}`,
  input: WaitForTerminalInput,
) {
  return pollUntil({
    fetch: async () => {
      const response = await transport.request<GetWorkspaceRunResponse>(
        `/v1/workspace-runs/${workspaceRunId}`,
        { method: "GET", signal: input.signal },
      );
      return response.workspaceRun;
    },
    isTerminal: (workspaceRun) => isTerminalWorkspaceRunStatus(workspaceRun.status),
    options: { timeoutMs: 10 * 60_000, ...input },
    timeoutMessage: `Timed out waiting for Workspace Run ${workspaceRunId} to finish.`,
  });
}

function isTerminalWorkspaceRunStatus(status: string): boolean {
  return status === "succeeded" || status === "failed" || status === "canceled";
}

function archiveHeaders(input: {
  readonly sha256: string;
  readonly sizeBytes: number;
}): Headers {
  const headers = new Headers();
  headers.set("content-type", "application/gzip");
  headers.set("x-crownest-archive-sha256", input.sha256);
  headers.set("x-crownest-archive-size", String(input.sizeBytes));
  return headers;
}

function workspaceRunEventParams(input: WorkspaceRunEventsInput): URLSearchParams {
  const params = new URLSearchParams();
  if (input.afterSeq !== undefined) {
    params.set("afterSeq", String(input.afterSeq));
  }
  if (input.limit !== undefined) {
    params.set("limit", String(input.limit));
  }
  return params;
}

async function* streamWorkspaceRunEvents(
  transport: Transport,
  workspaceRunId: `wsr_${string}`,
  input: WorkspaceRunEventsInput,
): AsyncIterable<WorkspaceRunStreamEvent> {
  if (input.reconnect === false) {
    yield* streamWorkspaceRunEventsOnce(transport, workspaceRunId, input);
    return;
  }

  let afterSeq = input.afterSeq;
  let retryIndex = 0;
  let originalError: unknown;

  for (;;) {
    let madeProgress = false;
    try {
      const nextInput = afterSeq === undefined ? input : { ...input, afterSeq };
      for await (const event of streamWorkspaceRunEventsOnce(
        transport,
        workspaceRunId,
        nextInput,
      )) {
        madeProgress = workspaceRunEventMadeProgress(event.seq, afterSeq);
        afterSeq = event.seq;
        yield event;
        if (isTerminalWorkspaceRunEvent(event)) {
          return;
        }
      }
      originalError ??= new Error(
        "Workspace Run event stream ended before a terminal event.",
      );
    } catch (error) {
      originalError = rememberStreamError(error, originalError, input.signal);
    }

    if (madeProgress) {
      retryIndex = 0;
    }
    if (retryIndex >= streamReconnectDelaysMs.length) {
      throw originalError;
    }
    await delay(streamReconnectDelaysMs[retryIndex] ?? 4_000);
    retryIndex += 1;
  }
}

function workspaceRunEventMadeProgress(
  seq: number,
  afterSeq: number | undefined,
): boolean {
  return afterSeq === undefined || seq > afterSeq;
}

function rememberStreamError(
  error: unknown,
  originalError: unknown,
  signal: AbortSignal | undefined,
): unknown {
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException("The operation was aborted.", "AbortError");
  }
  if (
    error instanceof CrowNestApiError ||
    (error instanceof Error && error.name === "TimeoutError")
  ) {
    throw error;
  }
  return originalError ?? error;
}

function streamWorkspaceRunEventsOnce(
  transport: Transport,
  workspaceRunId: `wsr_${string}`,
  input: WorkspaceRunEventsInput,
): AsyncIterable<WorkspaceRunStreamEvent> {
  const params = workspaceRunEventParams(input);
  params.set("stream", "true");
  return transport.streamSse<WorkspaceRunStreamEvent>(
    `/v1/workspace-runs/${workspaceRunId}/events${queryString(params)}`,
    {
      signal: input.signal,
      streamIdleTimeoutMs: input.streamIdleTimeoutMs,
      timeoutMs: input.timeoutMs,
    },
  );
}

function isTerminalWorkspaceRunEvent(event: WorkspaceRunStreamEvent): boolean {
  return event.type === "terminal" || event.type === "error";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function bodyFromBytes(bytes: Uint8Array): BodyInit {
  const bodyBytes = new Uint8Array(bytes.byteLength);
  bodyBytes.set(bytes);
  return new Blob([bodyBytes.buffer]);
}

function workspaceRunListParams(input: ListWorkspaceRunsInput): URLSearchParams {
  const params = paginationParams(input);
  if (input.projectId !== undefined) {
    params.set("projectId", input.projectId);
  }
  if (input.status !== undefined) {
    params.set("status", input.status);
  }
  for (const [key, value] of Object.entries(input.metadata ?? {})) {
    params.set(`metadata.${key}`, value);
  }
  return params;
}

async function bodyBytes(body: BodyInit): Promise<Uint8Array> {
  if (body instanceof Uint8Array) return body;
  return new Uint8Array(await new Response(body).arrayBuffer());
}

/* eslint-enable max-lines-per-function -- End Workspace Run resource client. */
