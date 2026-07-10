import { CrowNestApiError } from "@crownest/sdk";
import { describe, expect, it } from "vitest";

import { errorResult, toolError } from "../errors";
import { text } from "./mcp-test-helpers";

describe("toolError", () => {
  it("returns parseable JSON error payloads", () => {
    const result = errorResult("usage_error", "Bad input.");

    expect(result.isError).toBe(true);
    expect(JSON.parse(text(result))).toEqual({
      error: {
        code: "usage_error",
        details: null,
        message: "Bad input.",
        remediation: null,
        requestId: null,
        retryable: false,
        status: null,
      },
    });
  });

  it("preserves API error code, status, and details", () => {
    const result = toolError(
      new CrowNestApiError(429, {
        code: "rate_limited",
        details: { retryAfterMs: 1000 },
        message: "Too many requests.",
      }),
    );

    expect(JSON.parse(text(result))).toEqual({
      error: {
        code: "rate_limited",
        details: { retryAfterMs: 1000 },
        message: "Too many requests.",
        remediation: null,
        requestId: null,
        retryable: true,
        status: 429,
      },
    });
  });

  it("preserves API request ids and explicit retryability", () => {
    const error = new CrowNestApiError(503, {
      code: "service_unavailable",
      message: "Try again later.",
      retryable: false,
    });
    Object.defineProperty(error, "requestId", { value: "req_123" });

    const result = toolError(error);

    expect(JSON.parse(text(result))).toMatchObject({
      error: {
        code: "service_unavailable",
        requestId: "req_123",
        retryable: false,
        status: 503,
      },
    });
  });
});
