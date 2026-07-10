import { describe, expect, it, vi } from "vitest";

import { runCli } from "../index";

const cliEnvironment = {
  CROWNEST_API_KEY: "cn_live_test",
  CROWNEST_API_URL: "https://api.test",
} as const;

describe("preview CLI commands", () => {
  registerPreviewLifecycleTests();
  registerPreviewTokenTests();
  registerPreviewValidationTests();
});

function registerPreviewLifecycleTests() {
  it("creates, lists, and revokes previews", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ preview: previewResponse() }))
      .mockResolvedValueOnce(
        jsonResponse({ data: [previewResponse()], hasMore: false }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          preview: previewResponse({ revokedAt: "2026-06-09T15:40:00.000Z" }),
        }),
      );

    await expect(
      runCli(
        ["previews", "create", "sbx_123", "--port", "8080"],
        cliEnvironment,
        fetchMock,
      ),
    ).resolves.toMatchObject({
      stdout: "https://p-a1b2c3.crownest.dev\n",
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://api.test/v1/sandboxes/sbx_123/previews",
    );
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({ port: 8080 }));

    const listResult = await runCli(
      ["previews", "list", "sbx_123"],
      cliEnvironment,
      fetchMock,
    );

    expect(listResult.stdout).toContain("prv_123");
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://api.test/v1/sandboxes/sbx_123/previews",
    );

    const revokeResult = await runCli(
      ["previews", "revoke", "prv_123"],
      cliEnvironment,
      fetchMock,
    );
    expect(revokeResult.stdout).toContain("status: revoked");
    expect(fetchMock.mock.calls[2]?.[0]).toBe("https://api.test/v1/previews/prv_123");
    expect(fetchMock.mock.calls[2]?.[1]?.method).toBe("DELETE");
  });
}

function registerPreviewTokenTests() {
  it("creates token previews and prints the one-time token", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        preview: previewResponse({ authMode: "token" }),
        previewToken: "pvt_abc123",
      }),
    );

    await expect(
      runCli(
        ["previews", "create", "sbx_123", "--port", "8080", "--auth", "token"],
        cliEnvironment,
        fetchMock,
      ),
    ).resolves.toMatchObject({
      stdout: "https://p-a1b2c3.crownest.dev\nPreview token (shown once): pvt_abc123\n",
    });
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(
      JSON.stringify({ authMode: "token", port: 8080 }),
    );
  });

  it("accepts canonical --auth-mode for token previews", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        preview: previewResponse({ authMode: "token" }),
        previewToken: "pvt_abc123",
      }),
    );

    await expect(
      runCli(
        ["previews", "create", "sbx_123", "--port", "8080", "--auth-mode", "token"],
        cliEnvironment,
        fetchMock,
      ),
    ).resolves.toMatchObject({
      stdout: "https://p-a1b2c3.crownest.dev\nPreview token (shown once): pvt_abc123\n",
    });
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(
      JSON.stringify({ authMode: "token", port: 8080 }),
    );
  });
}

function registerPreviewValidationTests() {
  it("rejects malformed preview ports without calling the API", async () => {
    const fetchMock = vi.fn<typeof fetch>();

    await expect(
      runCli(
        ["previews", "create", "sbx_123", "--port", "8080abc"],
        cliEnvironment,
        fetchMock,
      ),
    ).resolves.toMatchObject({
      exitCode: 2,
      stderr: "port must be an integer from 1 to 65535.\n",
    });
    await expect(
      runCli(
        ["previews", "create", "sbx_123", "--port", "8080.5"],
        cliEnvironment,
        fetchMock,
      ),
    ).resolves.toMatchObject({
      exitCode: 2,
      stderr: "port must be an integer from 1 to 65535.\n",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects missing preview auth mode values without calling the API", async () => {
    const fetchMock = vi.fn<typeof fetch>();

    await expect(
      runCli(
        ["previews", "create", "sbx_123", "--port", "8080", "--auth"],
        cliEnvironment,
        fetchMock,
      ),
    ).resolves.toMatchObject({
      exitCode: 2,
      stderr: "--auth requires a value.\n",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
}

function previewResponse(
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
