import { type ApiKeyScope, ApiKeyScopes, CrowNestApiError } from "@crownest/sdk";

import { saveCredentialConfig } from "./credential-config";
import {
  booleanFlag,
  jsonFlagSpec,
  type ParsedFlags,
  parseFlags,
  rejectExtraPositionals,
  stringArrayFlag,
  stringFlag,
  UsageError,
} from "./flags";
import type { CliEnvironment, CliResult } from "./index";
import { jsonEnvelope, jsonPageEnvelope, renderList, renderRecord } from "./output";
import {
  collectPages,
  type Page,
  paginationFlagSpec,
  paginationOptions,
  paginationSearchParams,
} from "./pagination";

type HumanSession = {
  readonly orgId: `org_${string}`;
  readonly role: "admin" | "owner";
  readonly userId: `usr_${string}`;
};

type ApiErrorPayload = {
  readonly error?: {
    readonly code?: string;
    readonly details?: Readonly<Record<string, unknown>>;
    readonly message?: string;
  };
};

export function loginCommand(
  args: readonly string[],
  environment: CliEnvironment,
): CliResult {
  const parsed = parseFlags(args, {
    "--api-key": "string",
    "--api-url": "string",
    ...jsonFlagSpec,
  });
  rejectExtraPositionals(parsed.positionals, "login");
  const apiKey = stringFlag(parsed.flags, "--api-key") ?? environment.CROWNEST_API_KEY;
  const apiUrl =
    stringFlag(parsed.flags, "--api-url") ??
    environment.CROWNEST_API_URL ??
    "https://api.crownest.dev";
  const json = booleanFlag(parsed.flags, "--json");

  if (apiKey) {
    saveCredentialConfig(environment, { apiKey, apiUrl });

    return ok(
      json
        ? jsonEnvelope({ apiUrl, saved: true })
        : `Saved CrowNest credentials for ${apiUrl}.\nInstall the CrowNest Agent Skill for compatible coding agents with: crownest skills install\n`,
    );
  }

  const guidance = [
    "Create an API key at https://crownest.dev, then run:",
    `crownest login --api-url ${apiUrl} --api-key cn_live_...`,
    "",
    "You can also set CROWNEST_API_KEY and run crownest login to save it.",
    "",
  ].join("\n");

  return ok(
    json
      ? jsonEnvelope({
          apiUrl,
          command: `crownest login --api-url ${apiUrl} --api-key cn_live_...`,
          saved: false,
        })
      : guidance,
  );
}

export async function createApiKeyCommand(
  args: readonly string[],
  environment: CliEnvironment,
  fetchImpl: typeof fetch = fetch,
): Promise<CliResult> {
  const parsed = parseFlags(args, {
    "--api-url": "string",
    "--name": "string",
    "--project": "string",
    "--scope": "string[]",
    ...jsonFlagSpec,
  });
  rejectExtraPositionals(parsed.positionals, "keys create");
  const session = humanSession(environment, "keys create");
  const response = await fetchImpl(`${apiBaseUrl(parsed, environment)}/v1/api-keys`, {
    body: JSON.stringify(createApiKeyBody(parsed)),
    headers: {
      "content-type": "application/json",
      "x-crownest-org-id": session.orgId,
      "x-crownest-role": session.role,
      "x-crownest-user-id": session.userId,
    },
    method: "POST",
  });
  const payload = (await response.json()) as ApiErrorPayload & {
    readonly error?: { readonly message: string };
    readonly secret?: string;
  };

  if (!response.ok) {
    throwApiError(
      response,
      payload,
      "api_key_creation_failed",
      "API key creation failed.",
    );
  }

  const result = { secret: payload.secret ?? "" };
  return ok(
    booleanFlag(parsed.flags, "--json") ? jsonEnvelope(result) : renderRecord(result),
  );
}

export async function listApiKeysCommand(
  args: readonly string[],
  environment: CliEnvironment,
  fetchImpl: typeof fetch = fetch,
): Promise<CliResult> {
  const parsed = parseFlags(args, {
    "--api-url": "string",
    ...paginationFlagSpec,
    ...jsonFlagSpec,
  });
  rejectExtraPositionals(parsed.positionals, "keys list");
  const session = humanSession(environment, "keys list");
  const options = paginationOptions(parsed.flags);
  const keysPage = await collectPages(options, async (cursor) => {
    const query = paginationSearchParams(options, cursor).toString();
    const response = await fetchImpl(
      `${apiBaseUrl(parsed, environment)}/v1/api-keys${query.length === 0 ? "" : `?${query}`}`,
      {
        headers: {
          "x-crownest-org-id": session.orgId,
          "x-crownest-role": session.role,
          "x-crownest-user-id": session.userId,
        },
        method: "GET",
      },
    );
    const payload = (await response.json()) as ApiErrorPayload & {
      readonly data?: readonly Record<string, unknown>[];
      readonly error?: { readonly message: string };
      readonly hasMore?: boolean;
      readonly nextCursor?: string;
    };

    if (!response.ok) {
      throwApiError(
        response,
        payload,
        "api_key_listing_failed",
        "API key listing failed.",
      );
    }
    return {
      data: payload.data ?? [],
      hasMore: payload.hasMore ?? false,
      ...(payload.nextCursor === undefined ? {} : { nextCursor: payload.nextCursor }),
    } satisfies Page<Record<string, unknown>>;
  });
  return ok(
    booleanFlag(parsed.flags, "--json")
      ? jsonPageEnvelope(keysPage)
      : renderList(keysPage.data, [
          { key: "id" },
          { key: "name" },
          { key: "prefix" },
          { key: "last4" },
          { key: "createdAt" },
        ]),
  );
}

function createApiKeyBody(parsed: ParsedFlags) {
  const name = stringFlag(parsed.flags, "--name") ?? "CLI key";
  const projectId = stringFlag(parsed.flags, "--project");
  const scopes = scopeOptions(parsed);

  return {
    name,
    ...(projectId === undefined ? {} : { projectIds: [projectId] }),
    scopes: scopes.length === 0 ? quickstartDeveloperScopes : scopes,
  };
}

function scopeOptions(parsed: ParsedFlags): readonly ApiKeyScope[] {
  return stringArrayFlag(parsed.flags, "--scope").map((scope) => {
    if (!(ApiKeyScopes as readonly string[]).includes(scope)) {
      throw new UsageError(`invalid API key scope: ${scope}`);
    }
    return scope as ApiKeyScope;
  });
}

function throwApiError(
  response: Response,
  payload: ApiErrorPayload,
  fallbackCode: string,
  fallbackMessage: string,
): never {
  throw new CrowNestApiError(response.status, {
    code: payload.error?.code ?? fallbackCode,
    ...(payload.error?.details === undefined ? {} : { details: payload.error.details }),
    message: payload.error?.message ?? fallbackMessage,
  });
}

function humanSession(environment: CliEnvironment, command: string): HumanSession {
  const orgId = environment.CROWNEST_ORG_ID;
  const role = environment.CROWNEST_ROLE;
  const userId = environment.CROWNEST_USER_ID;

  if (!orgId?.startsWith("org_") || !userId?.startsWith("usr_")) {
    throw new Error(
      `CROWNEST_ORG_ID and CROWNEST_USER_ID are required for ${command}.`,
    );
  }

  if (role !== "owner" && role !== "admin") {
    throw new Error(`CROWNEST_ROLE must be owner or admin for ${command}.`);
  }

  return { orgId: orgId as `org_${string}`, role, userId: userId as `usr_${string}` };
}

function apiBaseUrl(parsed: ParsedFlags, environment: CliEnvironment): string {
  return (
    stringFlag(parsed.flags, "--api-url") ??
    environment.CROWNEST_API_URL ??
    "http://127.0.0.1:8787"
  ).replace(/\/$/, "");
}

function ok(stdout: string): CliResult {
  return { exitCode: 0, stderr: "", stdout };
}

const quickstartDeveloperScopes = [
  "sandbox:create",
  "sandbox:read",
  "sandbox:kill",
  "sandbox:extend",
  "command:run",
  "command:read",
  "command:cancel",
  "code:run",
  "file:read",
  "file:write",
  "artifact:create",
  "artifact:read",
  "artifact:delete",
  "preview:create",
  "preview:read",
  "preview:revoke",
  "workspace_run:create",
  "workspace_run:read",
  "workspace_run:cancel",
] as const satisfies readonly ApiKeyScope[];
