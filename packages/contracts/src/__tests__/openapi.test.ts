/* eslint-disable max-lines-per-function -- OpenAPI tests assert one generated document. */

import { describe, expect, it } from "vitest";

import { crownestOpenApiDocument, publicApiRouteSpecs } from "../openapi";

describe("crownestOpenApiDocument", () => {
  it("covers every canonical public route spec", () => {
    for (const spec of publicApiRouteSpecs) {
      expect(
        crownestOpenApiDocument.paths[spec.path]?.[methodKey(spec.method)],
      ).toMatchObject({
        operationId: spec.operationId,
        summary: spec.summary,
      });
    }
  });

  it("documents agent-critical paths and contracts", () => {
    expect(crownestOpenApiDocument.paths["/.well-known/api-catalog"]).toBeDefined();
    expect(crownestOpenApiDocument.paths["/openapi.json"]).toBeDefined();
    expect(crownestOpenApiDocument.paths["/v1/sandboxes"]).toBeDefined();
    expect(crownestOpenApiDocument.paths["/v1/workspace-runs"]).toBeDefined();
    expect(
      crownestOpenApiDocument.paths["/v1/workspace-runs/{workspaceRunId}/events"],
    ).toBeDefined();
    expect(crownestOpenApiDocument.components.schemas.ApiErrorResponse).toMatchObject({
      properties: {
        error: {
          properties: {
            requestId: { type: "string" },
            retryable: { type: "boolean" },
          },
        },
      },
      required: ["error"],
    });
    expect(crownestOpenApiDocument.components.schemas.ApiKeyScope.enum).toContain(
      "backup:restore",
    );
  });

  it("marks retryable mutations with the idempotency key header", () => {
    expect(
      JSON.stringify(crownestOpenApiDocument.paths["/v1/sandboxes"]?.post),
    ).toContain("#/components/parameters/idempotencyKey");
  });

  it("documents cursor pagination on every resource list", () => {
    const listPaths = [
      "/v1/projects",
      "/v1/api-keys",
      "/v1/sandboxes",
      "/v1/sandboxes/{sandboxId}/code/contexts",
      "/v1/sandboxes/{sandboxId}/artifacts",
      "/v1/sandboxes/{sandboxId}/previews",
      "/v1/workspace-runs",
    ] as const;

    for (const path of listPaths) {
      expect(parameterNames(operation("GET", path))).toEqual(
        expect.arrayContaining([
          "#/components/parameters/cursor",
          "#/components/parameters/limit",
        ]),
      );
    }
  });

  it("documents correlation, retry, and rate-limit response headers", () => {
    const responses = operation("GET", "/v1/sandboxes").responses as Record<
      string,
      { headers?: Record<string, unknown> }
    >;
    expect(responses["200"]?.headers).toHaveProperty("x-request-id");
    expect(responses["200"]?.headers).toHaveProperty("X-RateLimit-Limit");
    expect(responses["429"]?.headers).toHaveProperty("Retry-After");
    expect(responses["503"]?.headers).toHaveProperty("Retry-After");
  });

  it("documents file query parameters without adding cursor pagination", () => {
    const listFiles = operation("GET", "/v1/sandboxes/{sandboxId}/files");
    const readFile = operation("GET", "/v1/sandboxes/{sandboxId}/files/read");
    const deleteFile = operation("DELETE", "/v1/sandboxes/{sandboxId}/files");

    expect(parameterNames(listFiles)).toEqual(["sandboxId", "path"]);
    expect(requiredParameterNames(readFile)).toEqual(["sandboxId", "path"]);
    expect(requiredParameterNames(deleteFile)).toEqual(["sandboxId", "path"]);
    expect(parameterNames(readFile)).toContain("encoding");
    expect(parameterNames(listFiles)).not.toContain("cursor");
    expect(parameterNames(listFiles)).not.toContain("limit");
  });

  it("uses route-declared success statuses instead of operation-name inference", () => {
    expect(
      responseStatuses("POST", "/v1/sandboxes/{sandboxId}/commands/start"),
    ).toContain("202");
    expect(
      responseStatuses("POST", "/v1/commands/{commandId}/logs/download-url"),
    ).toContain("200");
    expect(
      responseStatuses("POST", "/v1/commands/{commandId}/logs/download-url"),
    ).not.toContain("201");
    expect(responseStatuses("POST", "/v1/sandboxes")).toContain("201");
  });

  it("documents canonical command execution and deprecated aliases", () => {
    const canonical = operation("POST", "/v1/sandboxes/{sandboxId}/commands");
    expect(responseStatuses("POST", "/v1/sandboxes/{sandboxId}/commands")).toEqual(
      expect.arrayContaining(["200", "202"]),
    );
    expect(parameterNames(canonical)).toContain(
      "#/components/parameters/idempotencyKey",
    );
    expect(crownestOpenApiDocument.components.schemas.RunCommandBody).toMatchObject({
      properties: { background: { default: false, type: "boolean" } },
      required: ["command"],
    });

    for (const path of [
      "/v1/sandboxes/{sandboxId}/commands/run",
      "/v1/sandboxes/{sandboxId}/commands/start",
    ] as const) {
      const alias = operation("POST", path);
      expect(alias.deprecated).toBe(true);
      for (const status of responseStatuses("POST", path)) {
        expect(alias.responses[status]).toHaveProperty("headers.Deprecation");
        expect(alias.responses[status]).toHaveProperty("headers.Sunset");
        expect(alias.responses[status]).toHaveProperty("headers.Link");
      }
    }
  });

  it("documents set-TTL semantics and the deprecated extend alias", () => {
    const canonical = operation("POST", "/v1/sandboxes/{sandboxId}/ttl");
    expect(canonical.description).toContain("resets the expiration countdown");
    expect(parameterNames(canonical)).toContain(
      "#/components/parameters/idempotencyKey",
    );
    expect(crownestOpenApiDocument.components.schemas.SetSandboxTtlBody).toMatchObject({
      required: ["ttlMs"],
    });

    const alias = operation("POST", "/v1/sandboxes/{sandboxId}/extend");
    expect(alias.deprecated).toBe(true);
    expect(alias.responses["200"]).toHaveProperty("headers.Deprecation");
    expect(alias.responses["200"]).toHaveProperty("headers.Sunset");
    expect(alias.responses["200"]).toHaveProperty("headers.Link");
  });

  it("excludes dashboard-only routes from the public contract", () => {
    expect(crownestOpenApiDocument.paths["/v1/bootstrap"]).toBeUndefined();
    expect(crownestOpenApiDocument.paths["/v1/api-keys"]?.post).toBeUndefined();
    expect(crownestOpenApiDocument.paths["/v1/billing/status"]).toBeUndefined();
    expect(JSON.stringify(crownestOpenApiDocument)).not.toContain(
      "#/components/schemas/Object",
    );
  });

  it("keeps pre-token identity claim unauthenticated", () => {
    expect(operation("POST", "/agent/identity/claim").security).toEqual([]);
  });

  it("documents OAuth token and revoke endpoints as form-url-encoded", () => {
    expect(requestMediaTypes(operation("POST", "/oauth2/token"))).toEqual([
      "application/x-www-form-urlencoded",
    ]);
    expect(requestMediaTypes(operation("POST", "/oauth2/revoke"))).toEqual([
      "application/x-www-form-urlencoded",
    ]);
  });

  it("documents file download URL body and archive upload headers", () => {
    expect(
      operation("POST", "/v1/sandboxes/{sandboxId}/files/download-url").requestBody,
    ).toMatchObject({
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/FileDownloadUrlBody" },
        },
      },
    });

    const archive = operation("PUT", "/v1/workspace-runs/{workspaceRunId}/archive");
    expect(requiredParameterNames(archive)).toEqual([
      "workspaceRunId",
      "content-length",
      "x-crownest-archive-sha256",
      "x-crownest-archive-size",
    ]);
  });

  it("documents staged archive transfer idempotency and response shapes", () => {
    const createTransfer = operation(
      "POST",
      "/v1/workspace-runs/{workspaceRunId}/archive-transfer",
    );
    expect(parameterNames(createTransfer)).toContain(
      "#/components/parameters/idempotencyKey",
    );
    expect(
      responseStatuses("POST", "/v1/workspace-runs/{workspaceRunId}/archive-transfer"),
    ).toContain("201");
    expect(createTransfer.responses["201"]).toMatchObject({
      content: {
        "application/json": {
          schema: {
            $ref: "#/components/schemas/CreateWorkspaceRunArchiveTransferResponse",
          },
        },
      },
    });

    const uploadTransfer = operation(
      "PUT",
      "/v1/workspace-runs/{workspaceRunId}/archive-transfer/{uploadId}",
    );
    expect(requiredParameterNames(uploadTransfer)).toEqual([
      "workspaceRunId",
      "uploadId",
      "content-length",
    ]);
    expect(uploadTransfer.responses["204"]).toMatchObject({
      description: "Success.",
    });
    expect(uploadTransfer.responses["204"]).toHaveProperty("headers.x-request-id");

    const finalize = operation(
      "POST",
      "/v1/workspace-runs/{workspaceRunId}/archive/finalize",
    );
    expect(parameterNames(finalize)).toContain(
      "#/components/parameters/idempotencyKey",
    );
    expect(finalize.requestBody).toMatchObject({
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/FinalizeWorkspaceRunArchiveBody" },
        },
      },
    });
  });
});

function methodKey(method: string): Lowercase<string> {
  return method.toLowerCase() as Lowercase<string>;
}

function operation(method: string, path: string): OpenApiOperation {
  const item = crownestOpenApiDocument.paths[path];
  const result = item?.[methodKey(method)] as OpenApiOperation | undefined;
  expect(result).toBeDefined();
  if (result === undefined) {
    throw new Error(`Missing OpenAPI operation ${method} ${path}`);
  }
  return result;
}

function parameterNames(spec: OpenApiOperation): readonly string[] {
  return spec.parameters.map((parameter) => parameter.name ?? parameter.$ref ?? "");
}

function requiredParameterNames(spec: OpenApiOperation): readonly string[] {
  return spec.parameters
    .filter((parameter) => parameter.required === true)
    .map((parameter) => parameter.name ?? parameter.$ref ?? "");
}

function responseStatuses(method: string, path: string): readonly string[] {
  return Object.keys(operation(method, path).responses);
}

function requestMediaTypes(spec: OpenApiOperation): readonly string[] {
  return Object.keys((spec.requestBody as OpenApiRequestBody).content);
}

type OpenApiOperation = {
  readonly deprecated?: boolean;
  readonly description?: string;
  readonly parameters: readonly OpenApiParameter[];
  readonly requestBody?: unknown;
  readonly responses: Readonly<Record<string, unknown>>;
  readonly security: readonly unknown[];
};

type OpenApiParameter = {
  readonly $ref?: string;
  readonly name?: string;
  readonly required?: boolean;
};

type OpenApiRequestBody = {
  readonly content: Readonly<Record<string, unknown>>;
};

/* eslint-enable max-lines-per-function -- Re-enable after generated document assertions. */
