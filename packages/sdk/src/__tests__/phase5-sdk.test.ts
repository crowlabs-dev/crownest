import { describe, expect, it, vi } from "vitest";

import { createCrowNestClient } from "../index";

describe("Phase 5 SDK ergonomics", () => {
  registerProjectClientTests();
  registerIdempotencyTests();
});

function registerProjectClientTests() {
  it("lists projects from the top-level client", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        data: [
          {
            createdAt: "2026-06-09T15:30:00.000Z",
            id: "prj_123",
            name: "Default Project",
            orgId: "org_123",
          },
        ],
        hasMore: false,
      }),
    );
    const client = createCrowNestClient({
      apiKey: "cn_live_test",
      baseUrl: "https://api.test",
      fetch: fetchMock,
    });

    await expect(client.projects.list()).resolves.toEqual({
      data: [
        {
          createdAt: "2026-06-09T15:30:00.000Z",
          id: "prj_123",
          name: "Default Project",
          orgId: "org_123",
        },
      ],
      hasMore: false,
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.test/v1/projects");
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("GET");
  });
}

function registerIdempotencyTests() {
  it("sends caller-provided idempotency keys as headers", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(sandboxResponse())
      .mockResolvedValueOnce(sandboxResponse({ ttlMs: 5_400_000 }))
      .mockResolvedValueOnce(
        jsonResponse({
          command: {
            command: "python main.py",
            cwd: "/workspace",
            env: {},
            id: "cmd_123",
            sandboxId: "sbx_123",
            status: "exited",
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ artifact: artifactResponseBody() }));
    const client = createCrowNestClient({
      apiKey: "cn_live_test",
      baseUrl: "https://api.test",
      fetch: fetchMock,
    });

    await client.sandboxes.create({
      idempotencyKey: "create-key",
      projectId: "prj_123",
    });
    await client.sandboxes.setTtl("sbx_123", {
      idempotencyKey: "set-ttl-key",
      ttlMs: 5_400_000,
    });
    await client.commands.run("sbx_123", "python main.py", {
      idempotencyKey: "run-key",
    });
    await client.artifacts.create("sbx_123", {
      idempotencyKey: "artifact-key",
      path: "/workspace/output.txt",
    });

    expect(idempotencyHeader(fetchMock, 0)).toBe("create-key");
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(
      JSON.stringify({ projectId: "prj_123" }),
    );
    expect(idempotencyHeader(fetchMock, 1)).toBe("set-ttl-key");
    expect(fetchMock.mock.calls[1]?.[1]?.body).toBe(
      JSON.stringify({ ttlMs: 5_400_000 }),
    );
    expect(idempotencyHeader(fetchMock, 2)).toBe("run-key");
    expect(fetchMock.mock.calls[2]?.[1]?.body).toBe(
      JSON.stringify({ command: "python main.py" }),
    );
    expect(idempotencyHeader(fetchMock, 3)).toBe("artifact-key");
    expect(fetchMock.mock.calls[3]?.[1]?.body).toBe(
      JSON.stringify({ path: "/workspace/output.txt" }),
    );
  });
}

function idempotencyHeader(
  fetchMock: ReturnType<typeof vi.fn<typeof fetch>>,
  index: number,
) {
  const headers = fetchMock.mock.calls[index]?.[1]?.headers;
  expect(headers).toBeInstanceOf(Headers);
  return (headers as Headers).get("idempotency-key");
}

function sandboxResponse(overrides: Record<string, unknown> = {}): Response {
  return jsonResponse({
    sandbox: {
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
    },
  });
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

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status: 200,
  });
}
