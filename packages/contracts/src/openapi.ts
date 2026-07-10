/* eslint-disable max-lines -- Canonical OpenAPI route inventory is intentionally explicit. */

import { ApiKeyScopes } from "./public-resources.js";

export const CROWNEST_OPENAPI_CONTENT_TYPE =
  "application/vnd.oai.openapi+json; charset=utf-8";

type HttpMethod = "DELETE" | "GET" | "POST" | "PUT";
type AuthMode = "agent" | "bearer" | "dashboard" | "none";
type ApiKeyScope = (typeof ApiKeyScopes)[number];
type SuccessStatus = "200" | "201" | "202" | "204";
type QueryParamSpec = {
  readonly description: string;
  readonly name: string;
  readonly required?: boolean;
  readonly schema?: Record<string, unknown>;
};
type HeaderParamSpec = QueryParamSpec;

export const betaBackupScopeNotes = {
  "backup:create": "Beta / feature-gated",
  "backup:delete": "Beta / feature-gated",
  "backup:read": "Beta / feature-gated",
  "backup:restore": "Beta / feature-gated",
} as const;

export type PublicApiRouteSpec = {
  readonly additionalSuccessStatuses?: readonly SuccessStatus[];
  readonly auth?: AuthMode;
  readonly deprecated?: boolean;
  readonly description?: string;
  readonly headerParams?: readonly HeaderParamSpec[];
  readonly idempotent?: boolean;
  readonly method: HttpMethod;
  readonly operationId: string;
  readonly paginated?: boolean;
  readonly path: string;
  readonly queryParams?: readonly QueryParamSpec[];
  readonly requestBody?: string;
  readonly requestBodyMediaType?: string;
  readonly response?: string;
  readonly scope?: ApiKeyScope | "agent:bootstrap" | "dashboard_session";
  readonly successStatus?: SuccessStatus;
  readonly successorPath?: string;
  readonly summary: string;
  readonly tags: readonly string[];
};

const optionalWorkspacePathQuery = [
  queryParam("path", "Workspace path. Defaults to /workspace when omitted."),
] as const;

const requiredWorkspacePathQuery = [
  queryParam("path", "Workspace path.", { required: true }),
] as const;

const readFileQuery = [
  ...requiredWorkspacePathQuery,
  queryParam("encoding", "Response encoding for direct file reads.", {
    schema: { enum: ["utf8", "base64"], type: "string" },
  }),
] as const;

const sequencePaginationQuery = [
  queryParam("afterSeq", "Replay events or logs after this sequence number.", {
    schema: { minimum: 0, type: "integer" },
  }),
  queryParam("limit", "Maximum number of events or logs to return.", {
    schema: { maximum: 500, minimum: 1, type: "integer" },
  }),
] as const;

const archiveUploadHeaders = [
  headerParam("content-length", "Archive upload byte length.", {
    required: true,
    schema: { minimum: 0, type: "integer" },
  }),
  headerParam("x-crownest-archive-sha256", "Hex SHA-256 digest of the archive bytes.", {
    required: true,
  }),
  headerParam("x-crownest-archive-size", "Archive size in bytes.", {
    required: true,
    schema: { minimum: 0, type: "integer" },
  }),
] as const;

export const publicApiRouteSpecs = [
  route("GET", "/auth.md", "getAuthMd", "Discovery", "Read auth.md", {
    auth: "none",
    response: "Markdown",
  }),
  route(
    "GET",
    "/.well-known/api-catalog",
    "getApiCatalog",
    "Discovery",
    "Read the API Linkset catalog",
    { auth: "none", response: "Linkset" },
  ),
  route("GET", "/llms.txt", "getApiLlmsTxt", "Discovery", "Read API LLM index", {
    auth: "none",
    response: "Markdown",
  }),
  route("GET", "/openapi.json", "getOpenApi", "Discovery", "Read OpenAPI", {
    auth: "none",
    response: "OpenAPI",
  }),
  route(
    "GET",
    "/.well-known/oauth-protected-resource",
    "getOAuthProtectedResource",
    "Auth",
    "Read OAuth protected resource metadata",
    { auth: "none", response: "OAuthProtectedResource" },
  ),
  route(
    "GET",
    "/.well-known/oauth-authorization-server",
    "getOAuthAuthorizationServer",
    "Auth",
    "Read OAuth authorization server metadata",
    { auth: "none", response: "OAuthAuthorizationServer" },
  ),
  route("GET", "/.well-known/jwks.json", "getJwks", "Auth", "Read JWKS", {
    auth: "none",
    response: "Jwks",
  }),
  route(
    "POST",
    "/agent/identity",
    "createAgentIdentity",
    "Auth",
    "Start agent identity registration",
    {
      auth: "none",
      requestBody: "AgentIdentityRequest",
      response: "AgentIdentityResponse",
    },
  ),
  route(
    "POST",
    "/agent/identity/claim",
    "claimAgentIdentity",
    "Auth",
    "Start an agent identity claim",
    {
      auth: "none",
      requestBody: "AgentClaimRequest",
      response: "AgentClaimResponse",
      successStatus: "201",
    },
  ),
  route(
    "GET",
    "/agent/bootstrap",
    "getAgentBootstrap",
    "Auth",
    "Read agent bootstrap metadata",
    {
      auth: "agent",
      response: "AgentBootstrap",
      scope: "agent:bootstrap",
    },
  ),
  route(
    "POST",
    "/oauth2/token",
    "createOAuthToken",
    "Auth",
    "Exchange an agent credential for a token",
    {
      auth: "none",
      requestBody: "OAuthTokenRequest",
      requestBodyMediaType: "application/x-www-form-urlencoded",
      response: "OAuthTokenResponse",
    },
  ),
  route("POST", "/oauth2/revoke", "revokeOAuthToken", "Auth", "Revoke an agent token", {
    auth: "none",
    requestBody: "OAuthRevokeRequest",
    requestBodyMediaType: "application/x-www-form-urlencoded",
    response: "EmptyObject",
  }),
  route(
    "POST",
    "/agent/event/notify",
    "notifyAgentEvent",
    "Auth",
    "Receive provider security events",
    {
      auth: "none",
      requestBody: "AgentEventNotification",
      response: "EmptyObject",
    },
  ),
  route("GET", "/v1/projects", "listProjects", "Projects", "List projects", {
    paginated: true,
    response: "ProjectList",
  }),
  route("POST", "/v1/projects", "createProject", "Projects", "Create a project", {
    idempotent: true,
    requestBody: "CreateProjectBody",
    response: "CreateProjectResponse",
    scope: "project:create",
    successStatus: "201",
  }),
  route("GET", "/v1/usage", "getUsage", "Usage", "Read usage and quotas", {
    response: "UsageSummaryResponse",
    scope: "usage:read",
  }),
  route("GET", "/v1/api-keys", "listApiKeys", "API Keys", "List API key metadata", {
    paginated: true,
    response: "ApiKeyList",
    scope: "api_key:read",
  }),
  route(
    "GET",
    "/v1/api-keys/{apiKeyId}",
    "getApiKey",
    "API Keys",
    "Get API key metadata",
    {
      response: "GetApiKeyResponse",
      scope: "api_key:read",
    },
  ),
  route(
    "DELETE",
    "/v1/api-keys/{apiKeyId}",
    "revokeApiKey",
    "API Keys",
    "Revoke an API key",
    {
      response: "RevokeApiKeyResponse",
      scope: "api_key:revoke",
    },
  ),
  route("GET", "/v1/sandboxes", "listSandboxes", "Sandboxes", "List sandboxes", {
    paginated: true,
    response: "SandboxList",
    scope: "sandbox:read",
  }),
  route("POST", "/v1/sandboxes", "createSandbox", "Sandboxes", "Create a sandbox", {
    idempotent: true,
    requestBody: "CreateSandboxBody",
    response: "CreateSandboxResponse",
    scope: "sandbox:create",
    successStatus: "201",
  }),
  route(
    "GET",
    "/v1/sandboxes/{sandboxId}",
    "getSandbox",
    "Sandboxes",
    "Get a sandbox",
    {
      response: "GetSandboxResponse",
      scope: "sandbox:read",
    },
  ),
  route(
    "DELETE",
    "/v1/sandboxes/{sandboxId}",
    "killSandbox",
    "Sandboxes",
    "Kill a sandbox",
    {
      idempotent: true,
      response: "KillSandboxResponse",
      scope: "sandbox:kill",
    },
  ),
  route(
    "POST",
    "/v1/sandboxes/{sandboxId}/ttl",
    "setSandboxTtl",
    "Sandboxes",
    "Set sandbox TTL",
    {
      description:
        "Sets the sandbox TTL and resets the expiration countdown from the time of this request.",
      idempotent: true,
      requestBody: "SetSandboxTtlBody",
      response: "SetSandboxTtlResponse",
      scope: "sandbox:extend",
    },
  ),
  route(
    "POST",
    "/v1/sandboxes/{sandboxId}/extend",
    "extendSandbox",
    "Sandboxes",
    "Extend sandbox TTL (deprecated)",
    {
      deprecated: true,
      description:
        "Deprecated alias for POST /v1/sandboxes/{sandboxId}/ttl. Sets the sandbox TTL and resets the expiration countdown from the time of this request.",
      idempotent: true,
      requestBody: "ExtendSandboxBody",
      response: "ExtendSandboxResponse",
      scope: "sandbox:extend",
      successorPath: "/v1/sandboxes/{sandboxId}/ttl",
    },
  ),
  route(
    "POST",
    "/v1/sandboxes/{sandboxId}/commands",
    "runCommand",
    "Commands",
    "Run a command",
    {
      additionalSuccessStatuses: ["202"],
      description:
        "Runs a command and waits by default. Set background=true to return immediately. collect and collectOn are only valid when background is false.",
      idempotent: true,
      requestBody: "RunCommandBody",
      response: "RunCommandResponse",
      scope: "command:run",
    },
  ),
  route(
    "POST",
    "/v1/sandboxes/{sandboxId}/commands/run",
    "runCommandDeprecated",
    "Commands",
    "Run a command and wait (deprecated)",
    {
      deprecated: true,
      description:
        "Deprecated foreground alias for POST /v1/sandboxes/{sandboxId}/commands.",
      idempotent: true,
      requestBody: "RunCommandBody",
      response: "RunCommandResponse",
      scope: "command:run",
      successorPath: "/v1/sandboxes/{sandboxId}/commands",
    },
  ),
  route(
    "POST",
    "/v1/sandboxes/{sandboxId}/commands/start",
    "startCommandDeprecated",
    "Commands",
    "Start a command (deprecated)",
    {
      deprecated: true,
      description:
        "Deprecated background alias for POST /v1/sandboxes/{sandboxId}/commands. collect and collectOn are not valid.",
      idempotent: true,
      requestBody: "RunCommandBody",
      response: "RunCommandResponse",
      scope: "command:run",
      successStatus: "202",
      successorPath: "/v1/sandboxes/{sandboxId}/commands",
    },
  ),
  route("GET", "/v1/commands/{commandId}", "getCommand", "Commands", "Get a command", {
    response: "GetCommandResponse",
    scope: "command:read",
  }),
  route(
    "POST",
    "/v1/commands/{commandId}/cancel",
    "cancelCommand",
    "Commands",
    "Cancel a command",
    {
      requestBody: "CancelCommandBody",
      response: "CancelCommandResponse",
      scope: "command:cancel",
    },
  ),
  route(
    "GET",
    "/v1/commands/{commandId}/logs",
    "listCommandLogs",
    "Commands",
    "List command logs",
    {
      queryParams: sequencePaginationQuery,
      response: "CommandLogs",
      scope: "command:read",
    },
  ),
  route(
    "GET",
    "/v1/commands/{commandId}/stream",
    "streamCommandLogs",
    "Commands",
    "Stream command logs",
    {
      queryParams: sequencePaginationQuery,
      response: "ServerSentEvents",
      scope: "command:read",
    },
  ),
  route(
    "POST",
    "/v1/commands/{commandId}/logs/download-url",
    "createCommandLogsDownloadUrl",
    "Commands",
    "Create a command log download URL",
    {
      response: "DownloadUrlResponse",
      scope: "command:read",
      successStatus: "200",
    },
  ),
  route(
    "POST",
    "/v1/sandboxes/{sandboxId}/code/contexts",
    "createCodeContext",
    "Code",
    "Create a code context",
    {
      requestBody: "CreateCodeContextBody",
      response: "CreateCodeContextResponse",
      scope: "code:run",
      successStatus: "201",
    },
  ),
  route(
    "GET",
    "/v1/sandboxes/{sandboxId}/code/contexts",
    "listCodeContexts",
    "Code",
    "List code contexts",
    {
      paginated: true,
      response: "CodeContextList",
      scope: "code:run",
    },
  ),
  route(
    "GET",
    "/v1/sandboxes/{sandboxId}/code/contexts/{contextId}",
    "getCodeContext",
    "Code",
    "Get a code context",
    {
      response: "GetCodeContextResponse",
      scope: "code:run",
    },
  ),
  route(
    "DELETE",
    "/v1/sandboxes/{sandboxId}/code/contexts/{contextId}",
    "deleteCodeContext",
    "Code",
    "Delete a code context",
    {
      response: "DeleteCodeContextResponse",
      scope: "code:run",
    },
  ),
  route("POST", "/v1/sandboxes/{sandboxId}/code/runs", "runCode", "Code", "Run code", {
    requestBody: "RunCodeBody",
    response: "RunCodeResponse",
    scope: "code:run",
  }),
  route(
    "POST",
    "/v1/sandboxes/{sandboxId}/code/runs/stream",
    "streamCodeRun",
    "Code",
    "Stream a code run",
    {
      requestBody: "RunCodeBody",
      response: "ServerSentEvents",
      scope: "code:run",
    },
  ),
  route("GET", "/v1/sandboxes/{sandboxId}/files", "listFiles", "Files", "List files", {
    queryParams: optionalWorkspacePathQuery,
    response: "FileList",
    scope: "file:read",
  }),
  route(
    "GET",
    "/v1/sandboxes/{sandboxId}/files/stat",
    "statFile",
    "Files",
    "Stat a file",
    {
      queryParams: requiredWorkspacePathQuery,
      response: "StatFileResponse",
      scope: "file:read",
    },
  ),
  route(
    "GET",
    "/v1/sandboxes/{sandboxId}/files/read",
    "readFile",
    "Files",
    "Read a file",
    {
      queryParams: readFileQuery,
      response: "ReadFileResponse",
      scope: "file:read",
    },
  ),
  route(
    "PUT",
    "/v1/sandboxes/{sandboxId}/files",
    "writeFile",
    "Files",
    "Write a file",
    {
      requestBody: "WriteFileBody",
      response: "WriteFileResponse",
      scope: "file:write",
    },
  ),
  route(
    "DELETE",
    "/v1/sandboxes/{sandboxId}/files",
    "deleteFile",
    "Files",
    "Delete a file",
    {
      queryParams: requiredWorkspacePathQuery,
      response: "DeleteFileResponse",
      scope: "file:write",
    },
  ),
  route(
    "POST",
    "/v1/sandboxes/{sandboxId}/files/mkdir",
    "makeDirectory",
    "Files",
    "Create a directory",
    {
      requestBody: "MkdirBody",
      response: "StatFileResponse",
      scope: "file:write",
    },
  ),
  route(
    "POST",
    "/v1/sandboxes/{sandboxId}/files/move",
    "moveFile",
    "Files",
    "Move a file",
    {
      requestBody: "MoveFileBody",
      response: "StatFileResponse",
      scope: "file:write",
    },
  ),
  route(
    "POST",
    "/v1/sandboxes/{sandboxId}/files/download-url",
    "createFileDownloadUrl",
    "Files",
    "Create a file download URL",
    {
      requestBody: "FileDownloadUrlBody",
      response: "DownloadUrlResponse",
      scope: "file:read",
      successStatus: "200",
    },
  ),
  route(
    "GET",
    "/v1/sandboxes/{sandboxId}/files/download",
    "downloadFile",
    "Files",
    "Download file bytes",
    {
      queryParams: requiredWorkspacePathQuery,
      response: "Binary",
      scope: "file:read",
    },
  ),
  route(
    "POST",
    "/v1/sandboxes/{sandboxId}/artifacts",
    "createArtifact",
    "Artifacts",
    "Create an artifact",
    {
      idempotent: true,
      requestBody: "CreateArtifactBody",
      response: "CreateArtifactResponse",
      scope: "artifact:create",
      successStatus: "201",
    },
  ),
  route(
    "GET",
    "/v1/sandboxes/{sandboxId}/artifacts",
    "listArtifacts",
    "Artifacts",
    "List artifacts",
    {
      paginated: true,
      response: "ArtifactList",
      scope: "artifact:read",
    },
  ),
  route(
    "GET",
    "/v1/artifacts/{artifactId}",
    "getArtifact",
    "Artifacts",
    "Get artifact metadata",
    {
      response: "GetArtifactResponse",
      scope: "artifact:read",
    },
  ),
  route(
    "POST",
    "/v1/artifacts/{artifactId}/download-url",
    "createArtifactDownloadUrl",
    "Artifacts",
    "Create artifact download URL",
    {
      response: "DownloadUrlResponse",
      scope: "artifact:read",
      successStatus: "200",
    },
  ),
  route(
    "GET",
    "/v1/artifacts/{artifactId}/download",
    "downloadArtifact",
    "Artifacts",
    "Download artifact bytes",
    {
      response: "Binary",
      scope: "artifact:read",
    },
  ),
  route(
    "DELETE",
    "/v1/artifacts/{artifactId}",
    "deleteArtifact",
    "Artifacts",
    "Delete an artifact",
    {
      response: "DeleteArtifactResponse",
      scope: "artifact:delete",
    },
  ),
  route(
    "POST",
    "/v1/sandboxes/{sandboxId}/previews",
    "createPreview",
    "Previews",
    "Create a preview",
    {
      requestBody: "CreatePreviewBody",
      response: "CreatePreviewResponse",
      scope: "preview:create",
      successStatus: "201",
    },
  ),
  route(
    "GET",
    "/v1/sandboxes/{sandboxId}/previews",
    "listPreviews",
    "Previews",
    "List previews",
    {
      paginated: true,
      response: "PreviewList",
      scope: "preview:read",
    },
  ),
  route("GET", "/v1/previews/{previewId}", "getPreview", "Previews", "Get a preview", {
    response: "GetPreviewResponse",
    scope: "preview:read",
  }),
  route(
    "DELETE",
    "/v1/previews/{previewId}",
    "revokePreview",
    "Previews",
    "Revoke a preview",
    {
      response: "DeletePreviewResponse",
      scope: "preview:revoke",
    },
  ),
  route(
    "POST",
    "/v1/workspace-runs",
    "createWorkspaceRun",
    "Workspace Runs",
    "Create a Workspace Run",
    {
      idempotent: true,
      requestBody: "CreateWorkspaceRunBody",
      response: "CreateWorkspaceRunResponse",
      scope: "workspace_run:create",
      successStatus: "201",
    },
  ),
  route(
    "GET",
    "/v1/workspace-runs",
    "listWorkspaceRuns",
    "Workspace Runs",
    "List Workspace Runs",
    {
      paginated: true,
      response: "WorkspaceRunList",
      scope: "workspace_run:read",
    },
  ),
  route(
    "GET",
    "/v1/workspace-runs/{workspaceRunId}",
    "getWorkspaceRun",
    "Workspace Runs",
    "Get Workspace Run status",
    {
      response: "CreateWorkspaceRunResponse",
      scope: "workspace_run:read",
    },
  ),
  route(
    "POST",
    "/v1/workspace-runs/{workspaceRunId}/start",
    "startWorkspaceRun",
    "Workspace Runs",
    "Start a Workspace Run",
    {
      idempotent: true,
      response: "CreateWorkspaceRunResponse",
      scope: "workspace_run:create",
    },
  ),
  route(
    "POST",
    "/v1/workspace-runs/{workspaceRunId}/cancel",
    "cancelWorkspaceRun",
    "Workspace Runs",
    "Cancel a Workspace Run",
    {
      response: "CreateWorkspaceRunResponse",
      scope: "workspace_run:cancel",
    },
  ),
  route(
    "GET",
    "/v1/workspace-runs/{workspaceRunId}/events",
    "listWorkspaceRunEvents",
    "Workspace Runs",
    "Replay Workspace Run events",
    {
      queryParams: sequencePaginationQuery,
      response: "WorkspaceRunEvents",
      scope: "workspace_run:read",
    },
  ),
  route(
    "GET",
    "/v1/workspace-runs/{workspaceRunId}/evidence",
    "getWorkspaceRunEvidence",
    "Workspace Runs",
    "Get Workspace Run evidence",
    {
      response: "WorkspaceRunEvidenceBundle",
      scope: "workspace_run:read",
    },
  ),
  route(
    "PUT",
    "/v1/workspace-runs/{workspaceRunId}/archive",
    "uploadWorkspaceRunArchive",
    "Workspace Runs",
    "Upload a Workspace Run archive",
    {
      headerParams: archiveUploadHeaders,
      idempotent: true,
      requestBody: "BinaryUpload",
      response: "WorkspaceRunArchiveResponse",
      scope: "workspace_run:create",
    },
  ),
  route(
    "POST",
    "/v1/workspace-runs/{workspaceRunId}/archive-transfer",
    "createWorkspaceRunArchiveTransfer",
    "Workspace Runs",
    "Create a staged archive transfer",
    {
      idempotent: true,
      requestBody: "CreateWorkspaceRunArchiveTransferBody",
      response: "CreateWorkspaceRunArchiveTransferResponse",
      scope: "workspace_run:create",
      successStatus: "201",
    },
  ),
  route(
    "PUT",
    "/v1/workspace-runs/{workspaceRunId}/archive-transfer/{uploadId}",
    "uploadWorkspaceRunArchiveTransfer",
    "Workspace Runs",
    "Upload staged archive bytes",
    {
      headerParams: [archiveUploadHeaders[0]],
      requestBody: "BinaryUpload",
      response: "NoContent",
      scope: "workspace_run:create",
      successStatus: "204",
    },
  ),
  route(
    "POST",
    "/v1/workspace-runs/{workspaceRunId}/archive/finalize",
    "finalizeWorkspaceRunArchive",
    "Workspace Runs",
    "Finalize a staged archive",
    {
      idempotent: true,
      requestBody: "FinalizeWorkspaceRunArchiveBody",
      response: "FinalizeWorkspaceRunArchiveResponse",
      scope: "workspace_run:create",
    },
  ),
] as const satisfies readonly PublicApiRouteSpec[];

export const crownestOpenApiDocument = {
  components: {
    parameters: {
      cursor: queryParameter("cursor", "Opaque pagination cursor."),
      idempotencyKey: {
        description: "Stable key for safely retrying idempotent mutations.",
        in: "header",
        name: "Idempotency-Key",
        required: false,
        schema: { maxLength: 255, minLength: 1, type: "string" },
      },
      limit: queryParameter("limit", "Maximum number of rows to return.", {
        maximum: 500,
        minimum: 1,
        type: "integer",
      }),
    },
    schemas: {
      AgentBootstrap: objectSchema("Agent bootstrap metadata."),
      AgentClaimRequest: objectSchema("Agent identity claim request."),
      AgentClaimResponse: objectSchema("Agent identity claim response."),
      AgentEventNotification: objectSchema("Trusted provider event notification."),
      AgentIdentityRequest: objectSchema("Agent identity registration request."),
      AgentIdentityResponse: objectSchema("Agent identity registration response."),
      ApiErrorResponse: {
        properties: {
          error: {
            properties: {
              code: { type: "string" },
              details: { additionalProperties: true, type: "object" },
              message: { type: "string" },
              requestId: { type: "string" },
              retryable: { type: "boolean" },
            },
            required: ["code", "message"],
            type: "object",
          },
        },
        required: ["error"],
        type: "object",
      },
      ApiKey: resourceSchema("key_"),
      ApiKeyList: paginationSchema("ApiKey"),
      ApiKeyScope: { enum: ApiKeyScopes, type: "string" },
      Artifact: resourceSchema("art_"),
      ArtifactList: paginationSchema("Artifact"),
      BetaBackupScope: {
        description: "Backup scopes are advertised for beta accounts only.",
        enum: Object.keys(betaBackupScopeNotes),
        type: "string",
      },
      BinaryUpload: { format: "binary", type: "string" },
      BootstrapRequest: objectSchema("Local bootstrap request."),
      BootstrapResponse: objectSchema("Local bootstrap response."),
      CancelCommandBody: objectSchema("Command cancellation request."),
      CancelCommandResponse: objectSchema("Command cancellation response."),
      CodeContext: resourceSchema("cctx_"),
      CodeContextList: paginationSchema("CodeContext"),
      Command: resourceSchema("cmd_"),
      CommandLogs: objectSchema("Bounded command log page."),
      CreateApiKeyBody: {
        properties: {
          name: { minLength: 1, type: "string" },
          projectIds: { items: { pattern: "^prj_", type: "string" }, type: "array" },
          scopes: { items: ref("ApiKeyScope"), minItems: 1, type: "array" },
        },
        required: ["name", "scopes"],
        type: "object",
      },
      CreateApiKeyResponse: objectWith("apiKey", "ApiKey", {
        secret: { type: "string" },
      }),
      CreateArtifactBody: objectSchema("Artifact creation request."),
      CreateArtifactResponse: objectWith("artifact", "Artifact"),
      CreateCodeContextBody: objectSchema("Code context creation request."),
      CreateCodeContextResponse: objectWith("context", "CodeContext"),
      CreatePreviewBody: objectSchema("Preview creation request."),
      CreatePreviewResponse: objectWith("preview", "Preview"),
      CreateProjectBody: objectSchema("Project creation request."),
      CreateProjectResponse: objectWith("project", "Project"),
      CreateSandboxBody: objectSchema("Sandbox creation request."),
      CreateSandboxResponse: objectWith("sandbox", "Sandbox"),
      CreateWorkspaceRunArchiveTransferBody: objectSchema(
        "Staged archive transfer request.",
      ),
      CreateWorkspaceRunArchiveTransferResponse: objectWith(
        "transfer",
        "WorkspaceRunArchiveTransfer",
      ),
      CreateWorkspaceRunBody: objectSchema("Workspace Run creation request."),
      CreateWorkspaceRunResponse: objectWith("workspaceRun", "WorkspaceRun"),
      DeleteArtifactResponse: objectWith("artifact", "Artifact"),
      DeleteCodeContextResponse: objectWith("context", "CodeContext"),
      DeleteFileResponse: objectSchema("File deletion result."),
      DeletePreviewResponse: objectWith("preview", "Preview"),
      DownloadUrlResponse: objectSchema("Short-lived bearer-capability download URL."),
      EmptyObject: { additionalProperties: false, type: "object" },
      ExtendSandboxBody: ref("SetSandboxTtlBody"),
      ExtendSandboxResponse: ref("SetSandboxTtlResponse"),
      FileDownloadUrlBody: {
        properties: { path: { minLength: 1, type: "string" } },
        required: ["path"],
        type: "object",
      },
      FileList: objectSchema("Workspace file list."),
      FinalizeWorkspaceRunArchiveBody: objectSchema("Staged archive finalize request."),
      FinalizeWorkspaceRunArchiveResponse: objectSchema(
        "Finalized Workspace Run archive response.",
      ),
      GetApiKeyResponse: objectWith("apiKey", "ApiKey"),
      GetArtifactResponse: objectWith("artifact", "Artifact"),
      GetCodeContextResponse: objectWith("context", "CodeContext"),
      GetCommandResponse: objectWith("command", "Command"),
      GetPreviewResponse: objectWith("preview", "Preview"),
      GetSandboxResponse: objectWith("sandbox", "Sandbox"),
      Jwks: objectSchema("JSON Web Key Set."),
      KillSandboxResponse: objectWith("sandbox", "Sandbox"),
      Linkset: objectSchema("RFC 9727 Linkset."),
      Markdown: { type: "string" },
      MkdirBody: objectSchema("Directory creation request."),
      MoveFileBody: objectSchema("File move request."),
      OAuthAuthorizationServer: objectSchema("OAuth authorization server metadata."),
      OAuthProtectedResource: objectSchema("OAuth protected resource metadata."),
      OAuthRevokeRequest: objectSchema("OAuth token revocation request."),
      OAuthTokenRequest: objectSchema("OAuth token request."),
      OAuthTokenResponse: objectSchema("OAuth token response."),
      NoContent: { description: "No response body.", type: "null" },
      OpenAPI: objectSchema("OpenAPI document."),
      Preview: resourceSchema("prv_"),
      PreviewList: paginationSchema("Preview"),
      Project: resourceSchema("prj_"),
      ProjectList: paginationSchema("Project"),
      ReadFileResponse: objectSchema("File contents."),
      RevokeApiKeyResponse: objectWith("apiKey", "ApiKey"),
      RunCodeBody: objectSchema("Code execution request."),
      RunCodeResponse: objectSchema("Code execution result."),
      RunCommandBody: {
        additionalProperties: true,
        description:
          "Command request. collect and collectOn are only valid when background is false.",
        properties: {
          background: { default: false, type: "boolean" },
          collect: { items: { type: "object" }, type: "array" },
          collectOn: { type: "string" },
          command: { minLength: 1, type: "string" },
          cwd: { type: "string" },
          env: { additionalProperties: { type: "string" }, type: "object" },
          timeoutMs: { exclusiveMinimum: 0, type: "number" },
        },
        required: ["command"],
        type: "object",
      },
      RunCommandResponse: objectWith("command", "Command"),
      Sandbox: resourceSchema("sbx_"),
      SandboxList: paginationSchema("Sandbox"),
      SetSandboxTtlBody: {
        description:
          "Sandbox TTL request. The countdown resets from the time of the request.",
        properties: { ttlMs: { exclusiveMinimum: 0, type: "number" } },
        required: ["ttlMs"],
        type: "object",
      },
      SetSandboxTtlResponse: objectWith("sandbox", "Sandbox"),
      ServerSentEvents: { type: "string" },
      StatFileResponse: objectSchema("File stat result."),
      UsageSummaryResponse: objectSchema("Usage and quota summary."),
      WorkspaceRun: resourceSchema("wsr_"),
      WorkspaceRunArchiveResponse: objectSchema("Workspace Run archive response."),
      WorkspaceRunArchiveTransfer: resourceSchema("upl_"),
      WorkspaceRunEvents: objectSchema("Bounded Workspace Run event page."),
      WorkspaceRunEvidenceBundle: objectSchema("Workspace Run evidence bundle."),
      WorkspaceRunList: paginationSchema("WorkspaceRun"),
      WriteFileBody: objectSchema("File write request."),
      WriteFileResponse: objectSchema("File write result."),
    },
    securitySchemes: {
      bearerAuth: {
        bearerFormat: "CrowNest API key or auth.md agent token",
        scheme: "bearer",
        type: "http",
      },
    },
  },
  info: {
    description:
      "Machine-readable contract for CrowNest public API, discovery, auth.md, and agent-operable resources.",
    title: "CrowNest API",
    version: "1.0.0",
  },
  openapi: "3.1.0",
  paths: routeSpecsToPaths(publicApiRouteSpecs),
  servers: [{ url: "https://api.crownest.dev" }],
  tags: [
    "Discovery",
    "Auth",
    "Projects",
    "Usage",
    "API Keys",
    "Sandboxes",
    "Commands",
    "Code",
    "Files",
    "Artifacts",
    "Previews",
    "Workspace Runs",
  ].map((name) => ({ name })),
} as const;

function route(
  method: HttpMethod,
  path: string,
  operationId: string,
  tag: string,
  summary: string,
  options: Omit<
    PublicApiRouteSpec,
    "method" | "operationId" | "path" | "summary" | "tags"
  > = {},
): PublicApiRouteSpec {
  return { method, operationId, path, summary, tags: [tag], ...options };
}

function routeSpecsToPaths(specs: readonly PublicApiRouteSpec[]) {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const spec of specs) {
    const pathItem = paths[spec.path] ?? {};
    pathItem[spec.method.toLowerCase()] = operation(spec);
    paths[spec.path] = pathItem;
  }

  return paths;
}

function operation(spec: PublicApiRouteSpec) {
  return {
    ...(spec.deprecated === true ? { deprecated: true } : {}),
    ...(spec.description === undefined ? {} : { description: spec.description }),
    operationId: spec.operationId,
    parameters: parameters(spec),
    responses: responses(spec),
    security: spec.auth === "none" ? [] : [{ bearerAuth: [] }],
    summary: spec.summary,
    tags: spec.tags,
    ...(spec.requestBody === undefined ? {} : { requestBody: requestBody(spec) }),
    ...(spec.scope === undefined ? {} : { "x-crownest-required-scope": spec.scope }),
  };
}

function parameters(spec: PublicApiRouteSpec) {
  const params: unknown[] = [...pathParameters(spec.path)];
  if (spec.idempotent) params.push(refParameter("idempotencyKey"));
  if (spec.paginated === true) {
    params.push(refParameter("cursor"), refParameter("limit"));
  }
  for (const query of spec.queryParams ?? [])
    params.push(queryParameterFromSpec(query));
  for (const header of spec.headerParams ?? [])
    params.push(headerParameterFromSpec(header));
  return params;
}

function pathParameters(path: string) {
  return [...path.matchAll(/\{([^}]+)\}/gu)].map((match) => ({
    in: "path",
    name: match[1] ?? "",
    required: true,
    schema: { type: "string" },
  }));
}

function responses(spec: PublicApiRouteSpec) {
  const successStatuses = [
    spec.successStatus ?? "200",
    ...(spec.additionalSuccessStatuses ?? []),
  ];
  const successResponses = Object.fromEntries(
    successStatuses.map((status) => [
      status,
      {
        ...(spec.response === "NoContent"
          ? {}
          : { content: content(spec.response ?? "Object") }),
        description: "Success.",
        headers: responseHeaders(spec),
      },
    ]),
  );
  return {
    ...successResponses,
    "400": errorResponse("Invalid request.", spec),
    "401": errorResponse("Missing or invalid bearer credential.", spec),
    "403": errorResponse(
      "Credential lacks the required scope or resource access.",
      spec,
    ),
    "404": errorResponse("Resource or route not found.", spec),
    "429": errorResponse("Rate limited or quota limited.", spec, true),
    "503": errorResponse("Service temporarily unavailable.", spec, true),
  };
}

function requestBody(spec: PublicApiRouteSpec) {
  const schemaName = spec.requestBody ?? "Object";
  const mediaType =
    spec.requestBodyMediaType ??
    (schemaName === "BinaryUpload" ? "application/gzip" : "application/json");

  return {
    content: { [mediaType]: { schema: ref(schemaName) } },
    required: true,
  };
}

function content(schemaName: string) {
  if (schemaName === "Binary") {
    return {
      "application/octet-stream": { schema: { format: "binary", type: "string" } },
    };
  }
  if (schemaName === "Markdown") {
    return { "text/markdown": { schema: ref("Markdown") } };
  }
  if (schemaName === "ServerSentEvents") {
    return { "text/event-stream": { schema: ref("ServerSentEvents") } };
  }
  return { "application/json": { schema: ref(schemaName) } };
}

function errorResponse(
  description: string,
  spec: PublicApiRouteSpec,
  retryAfter = false,
) {
  return {
    content: { "application/json": { schema: ref("ApiErrorResponse") } },
    description,
    headers: {
      ...responseHeaders(spec),
      ...(retryAfter
        ? {
            "Retry-After": {
              description: "Seconds to wait before retrying the request.",
              schema: { minimum: 0, type: "integer" },
            },
          }
        : {}),
    },
  };
}

function responseHeaders(spec: PublicApiRouteSpec) {
  return {
    ...standardResponseHeaders(),
    ...(spec.deprecated === true
      ? {
          Deprecation: {
            description: "Deprecation date as a Structured Field date value.",
            schema: { example: "@1783641600", type: "string" },
          },
          Link: {
            description: `Canonical successor endpoint: ${spec.successorPath ?? "the replacement route"}.`,
            schema: { type: "string" },
          },
          Sunset: {
            description: "Date after which the deprecated alias may be removed.",
            schema: {
              example: "Sat, 10 Jul 2027 23:59:59 GMT",
              type: "string",
            },
          },
        }
      : {}),
  };
}

function standardResponseHeaders() {
  return {
    "X-RateLimit-Limit": {
      description: "Request limit for the current rate-limit window, when known.",
      schema: { minimum: 0, type: "integer" },
    },
    "X-RateLimit-Remaining": {
      description: "Requests remaining in the current rate-limit window, when known.",
      schema: { minimum: 0, type: "integer" },
    },
    "x-request-id": {
      description: "Correlation identifier for this request.",
      schema: { type: "string" },
    },
  };
}

function ref(schemaName: string) {
  return { $ref: `#/components/schemas/${schemaName}` };
}

function refParameter(name: string) {
  return { $ref: `#/components/parameters/${name}` };
}

function queryParam(
  name: string,
  description: string,
  options: {
    readonly required?: boolean;
    readonly schema?: Record<string, unknown>;
  } = {},
): QueryParamSpec {
  return { description, name, ...options };
}

function queryParameterFromSpec(spec: QueryParamSpec) {
  return queryParameter(
    spec.name,
    spec.description,
    spec.schema,
    spec.required ?? false,
  );
}

function headerParam(
  name: string,
  description: string,
  options: {
    readonly required?: boolean;
    readonly schema?: Record<string, unknown>;
  } = {},
): HeaderParamSpec {
  return { description, name, ...options };
}

function headerParameterFromSpec(spec: HeaderParamSpec) {
  return {
    description: spec.description,
    in: "header",
    name: spec.name,
    required: spec.required ?? false,
    schema: spec.schema ?? { type: "string" },
  };
}

function queryParameter(
  name: string,
  description: string,
  schema: Record<string, unknown> = { type: "string" },
  required = false,
) {
  return { description, in: "query", name, required, schema };
}

function objectSchema(description: string) {
  return { additionalProperties: true, description, type: "object" };
}

function resourceSchema(prefix: string) {
  return {
    additionalProperties: true,
    properties: { id: { pattern: `^${prefix}`, type: "string" } },
    required: ["id"],
    type: "object",
  };
}

function paginationSchema(itemSchema: string) {
  return {
    properties: {
      data: { items: ref(itemSchema), type: "array" },
      hasMore: { type: "boolean" },
      nextCursor: { type: "string" },
    },
    required: ["data", "hasMore"],
    type: "object",
  };
}

function objectWith(field: string, schemaName: string, extra = {}) {
  return {
    properties: { [field]: ref(schemaName), ...extra },
    required: [field],
    type: "object",
  };
}

/* eslint-enable max-lines -- Re-enable after canonical OpenAPI inventory. */
