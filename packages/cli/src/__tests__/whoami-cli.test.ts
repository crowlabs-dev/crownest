import { describe, expect, it, vi } from "vitest";

import { runCli } from "../index";

const environment = {
  CROWNEST_API_KEY: "cn_live_abcdefghij_secret",
  CROWNEST_API_URL: "https://api.test",
} as const;

describe("whoami credential verification", () => {
  registerVerifiedCredentialTests();
  registerRejectedCredentialTests();
});

function registerVerifiedCredentialTests() {
  it("prints only safe API-key metadata", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        data: [
          {
            id: "key_123",
            name: "CI key",
            orgId: "org_123",
            prefix: "cn_live_abcdefghij",
            projectIds: ["prj_123"],
            scopes: ["sandbox:read"],
          },
        ],
        hasMore: false,
      }),
    );

    const result = await runCli(["whoami", "--json"], environment, fetchMock);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      data: {
        credentialType: "api_key",
        name: "CI key",
        orgId: "org_123",
        prefix: "cn_live_abcdefghij",
        projectIds: ["prj_123"],
        scopes: ["sandbox:read"],
        verified: true,
      },
    });
    expect(result.stdout).not.toContain("_secret");
  });

  it("degrades only authenticated missing-scope responses", async () => {
    const agent = await runCli(
      ["whoami", "--json"],
      {
        CROWNEST_API_URL: "https://api.test",
        CROWNEST_BEARER_TOKEN: "cn_agent_lookup_secret-value",
      },
      forbiddenResponse(),
    );

    expect(agent.exitCode).toBe(0);
    expect(JSON.parse(agent.stdout)).toMatchObject({
      data: {
        credentialType: "agent_token",
        missingScopes: ["api_key:read"],
        prefix: "cn_agent_lookup",
        scopes: "unavailable",
        verificationNote:
          "Credential verified, but api_key:read is missing; key metadata is unavailable.",
        verified: true,
      },
    });
    expect(agent.stdout).not.toContain("secret-value");

    const limitedKey = await runCli(
      ["whoami", "--json"],
      environment,
      forbiddenResponse(),
    );
    expect(limitedKey.exitCode).toBe(0);
    expect(JSON.parse(limitedKey.stdout)).toMatchObject({
      data: {
        credentialType: "api_key",
        missingScopes: ["api_key:read"],
        verified: true,
      },
    });
  });
}

function registerRejectedCredentialTests() {
  it("rejects suspended organizations and invalid credentials", async () => {
    const suspendedResult = await runCli(
      ["whoami", "--json"],
      environment,
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          errorResponse(403, "org_suspended", "Organization is suspended."),
        ),
    );
    expect(suspendedResult.exitCode).toBe(1);
    expect(suspendedResult.stdout).toBe("");
    expect(JSON.parse(suspendedResult.stderr)).toMatchObject({
      error: {
        code: "org_suspended",
        message: "Organization is suspended.",
        status: 403,
      },
    });

    const invalid = await runCli(
      ["whoami", "--json"],
      environment,
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          errorResponse(401, "invalid_api_key", "Invalid API key."),
        ),
    );
    expect(invalid.exitCode).toBe(1);
    expect(JSON.parse(invalid.stderr)).toMatchObject({
      error: { code: "invalid_api_key", status: 401 },
    });
  });
}

function forbiddenResponse(): ReturnType<typeof vi.fn<typeof fetch>> {
  return vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(errorResponse(403, "forbidden", "Missing required scope."));
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status: 200,
  });
}

function errorResponse(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    headers: { "content-type": "application/json" },
    status,
  });
}
