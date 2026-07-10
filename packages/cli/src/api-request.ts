import { CrowNestApiError } from "@crownest/sdk";

import { loadCredentialConfig } from "./credential-config";
import type { CliEnvironment } from "./index";

type ApiErrorPayload = {
  readonly error?: {
    readonly code?: string;
    readonly details?: Readonly<Record<string, unknown>>;
    readonly message?: string;
    readonly retryAfterMs?: number;
    readonly retryable?: boolean;
  };
};

export function configuredCredential(environment: CliEnvironment): string | undefined {
  const config = loadCredentialConfig(environment);
  return (
    environment.CROWNEST_BEARER_TOKEN ??
    environment.CROWNEST_API_KEY ??
    config.credential ??
    config.apiKey
  );
}

export function apiBaseUrl(environment: CliEnvironment): string {
  const config = loadCredentialConfig(environment);
  return (
    environment.CROWNEST_API_URL ??
    config.apiUrl ??
    "https://api.crownest.dev"
  ).replace(/\/$/, "");
}

export async function authenticatedFetch(
  environment: CliEnvironment,
  fetchImpl: typeof fetch | undefined,
  path: string,
): Promise<Response> {
  const credential = configuredCredential(environment);
  if (!credential) {
    throw new Error(
      "No CrowNest credential configured. Run `crownest login --api-key <key>` or set CROWNEST_API_KEY.",
    );
  }

  return await (fetchImpl ?? fetch)(`${apiBaseUrl(environment)}${path}`, {
    headers: new Headers({ authorization: `Bearer ${credential}` }),
    method: "GET",
  });
}

export async function apiPost<T>(
  environment: CliEnvironment,
  fetchImpl: typeof fetch | undefined,
  path: string,
  body: unknown,
  options: { readonly idempotencyKey?: string } = {},
): Promise<T> {
  const credential = configuredCredential(environment);
  if (!credential) {
    throw new Error(
      "No CrowNest credential configured. Run `crownest login --api-key <key>` or set CROWNEST_API_KEY.",
    );
  }

  const response = await (fetchImpl ?? fetch)(`${apiBaseUrl(environment)}${path}`, {
    body: JSON.stringify(body),
    headers: new Headers({
      authorization: `Bearer ${credential}`,
      "content-type": "application/json",
      // Mutating v1 endpoints require an idempotency key; one key per
      // logical operation so a retry of the same call replays safely.
      "idempotency-key": options.idempotencyKey ?? crypto.randomUUID(),
    }),
    method: "POST",
  });
  const payload = (await response.json()) as ApiErrorPayload & T;
  if (!response.ok) throwApiResponse(response, payload);
  return payload;
}

export async function apiGet<T>(
  environment: CliEnvironment,
  fetchImpl: typeof fetch | undefined,
  path: string,
): Promise<T> {
  const response = await authenticatedFetch(environment, fetchImpl, path);
  const payload = (await response.json()) as ApiErrorPayload & T;
  if (!response.ok) throwApiResponse(response, payload);
  return payload;
}

export function throwApiResponse(response: Response, payload: ApiErrorPayload): never {
  throw new CrowNestApiError(
    response.status,
    {
      code: payload.error?.code ?? "invalid_error_response",
      ...(payload.error?.details === undefined
        ? {}
        : { details: payload.error.details }),
      message:
        payload.error?.message ?? `CrowNest API request failed (${response.status}).`,
      ...(payload.error?.retryAfterMs === undefined
        ? {}
        : { retryAfterMs: payload.error.retryAfterMs }),
      ...(payload.error?.retryable === undefined
        ? {}
        : { retryable: payload.error.retryable }),
    },
    response.headers,
  );
}
