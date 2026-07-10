import { CrowNestApiError } from "@crownest/sdk";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { McpSessionError } from "./session";

export function toolError(error: unknown): CallToolResult {
  if (error instanceof CrowNestApiError) {
    const requestId = optionalString(error, "requestId");
    return errorResult(error.code, error.message, {
      details: error.details ?? null,
      ...(requestId === undefined ? {} : { requestId }),
      retryable: optionalBoolean(error, "retryable") ?? retryableApiError(error),
      status: error.status,
    });
  }

  if (error instanceof McpSessionError) {
    return errorResult(error.code, error.message);
  }

  if (error instanceof Error) {
    return errorResult("internal_error", error.message);
  }

  return errorResult("internal_error", String(error));
}

export function errorResult(
  code: string,
  message: string,
  options: {
    readonly details?: Readonly<Record<string, unknown>> | null;
    readonly remediation?: string | null;
    readonly requestId?: string | null;
    readonly retryable?: boolean;
    readonly status?: number | null;
  } = {},
): CallToolResult {
  return {
    content: [
      {
        text: JSON.stringify({
          error: {
            code,
            details: options.details ?? null,
            message,
            remediation: options.remediation ?? null,
            requestId: options.requestId ?? null,
            retryable: options.retryable ?? false,
            status: options.status ?? null,
          },
        }),
        type: "text",
      },
    ],
    isError: true,
  };
}

function retryableApiError(error: CrowNestApiError): boolean {
  return error.status === 429 || error.status >= 500 || error.code === "rate_limited";
}

function optionalBoolean(value: object, key: string): boolean | undefined {
  const field: unknown = (value as Readonly<Record<string, unknown>>)[key];
  return typeof field === "boolean" ? field : undefined;
}

function optionalString(value: object, key: string): string | undefined {
  const field: unknown = (value as Readonly<Record<string, unknown>>)[key];
  return typeof field === "string" ? field : undefined;
}
