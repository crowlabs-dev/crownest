import { describe, expect, it, vi } from "vitest";

import { createCrowNestClient } from "../index";

describe("SDK preview creation", () => {
  it("returns preview creation envelopes with one-time tokens", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        preview: previewResponseBody({ authMode: "token" }),
        previewToken: "pvt_abc123",
      }),
    );
    const client = createCrowNestClient({
      apiKey: "cn_live_test",
      baseUrl: "https://api.test",
      fetch: fetchMock,
    });

    await expect(
      client.previews.create("sbx_123", { authMode: "token", port: 8080 }),
    ).resolves.toMatchObject({
      preview: { authMode: "token", id: "prv_123" },
      previewToken: "pvt_abc123",
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://api.test/v1/sandboxes/sbx_123/previews",
    );
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(
      JSON.stringify({ authMode: "token", port: 8080 }),
    );
  });

  it("returns preview creation envelopes from sandbox handles", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(sandboxResponse())
      .mockResolvedValueOnce(
        jsonResponse({
          preview: previewResponseBody({ authMode: "token" }),
          previewToken: "pvt_handle",
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ preview: previewResponseBody() }))
      .mockResolvedValueOnce(
        jsonResponse({
          preview: previewResponseBody({ revokedAt: "2026-06-09T16:00:00.000Z" }),
        }),
      );
    const client = createCrowNestClient({
      apiKey: "cn_live_test",
      baseUrl: "https://api.test",
      fetch: fetchMock,
    });

    const sandbox = await client.sandboxes.get("sbx_123");

    await expect(
      sandbox.previews.create({ authMode: "token", port: 8080 }),
    ).resolves.toMatchObject({
      preview: { authMode: "token", id: "prv_123" },
      previewToken: "pvt_handle",
    });
    await expect(sandbox.previews.get("prv_123")).resolves.toMatchObject({
      id: "prv_123",
    });
    await expect(sandbox.previews.revoke("prv_123")).resolves.toMatchObject({
      revokedAt: "2026-06-09T16:00:00.000Z",
    });
  });
});

function sandboxResponse(): Response {
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
    },
  });
}

function previewResponseBody(
  input: {
    readonly authMode?: "authenticated" | "token";
    readonly revokedAt?: string;
  } = {},
) {
  return {
    authMode: input.authMode ?? "authenticated",
    createdAt: "2026-06-09T15:30:00.000Z",
    id: "prv_123",
    orgId: "org_123",
    port: 8080,
    projectId: "prj_123",
    sandboxId: "sbx_123",
    slug: "p-a1b2c3",
    url: "https://p-a1b2c3.crownest.dev",
    ...(input.revokedAt === undefined ? {} : { revokedAt: input.revokedAt }),
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status: 200,
  });
}
