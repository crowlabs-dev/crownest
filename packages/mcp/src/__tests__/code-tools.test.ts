import { describe, expect, it } from "vitest";

import { callTool, createHarness, createSandboxHandle, text } from "./mcp-test-helpers";

describe("code tools", () => {
  it("runs Python code with artifact promotion and formats all output kinds", async () => {
    const sandbox = createSandboxHandle("sbx_code");
    sandbox.mocks.codeRun.mockResolvedValueOnce(codeRunResult());
    const { tools } = createHarness([sandbox]);

    const result = await callTool(tools, "run_code", {
      code: "print('out')",
      timeout_ms: 1000,
    });

    expect(sandbox.mocks.codeRun).toHaveBeenCalledWith({
      artifactPolicy: "promote",
      code: "print('out')",
      timeoutMs: 1000,
    });
    expect(text(result)).toContain("sandbox_id: sbx_code");
    expect(text(result)).toContain("stdout:\nout");
    expect(text(result)).toContain("stderr:\nwarn");
    expect(text(result)).toContain("output (text): hello");
    expect(text(result)).toContain('output (json): {"ok":true}');
    expect(text(result)).toContain("artifact: art_123 (image/png, 42B)");
    expect(text(result)).toContain(
      "rejected output: svg (requires_artifact_promotion)",
    );
  });

  it("returns code execution errors as MCP tool errors with sandbox_id", async () => {
    const sandbox = createSandboxHandle("sbx_code");
    sandbox.mocks.codeRun.mockResolvedValueOnce(shortErrorResult());
    const { tools } = createHarness([sandbox]);

    const result = await callTool(tools, "run_code", { code: "raise ValueError()" });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("sandbox_id: sbx_code");
    expect(text(result)).toContain("ValueError: boom");
    expect(text(result)).toContain("line 1");
  });

  it("truncates long code execution errors after preserving sandbox_id", async () => {
    const sandbox = createSandboxHandle("sbx_code");
    sandbox.mocks.codeRun.mockResolvedValueOnce(longErrorResult());
    const { tools } = createHarness([sandbox]);

    const result = await callTool(tools, "run_code", { code: "raise Exception()" });

    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/^sandbox_id: sbx_code\n/);
    expect(text(result)).toContain("...");
    expect(text(result).length).toBeLessThan(2_050);
  });
});

function codeRunResult() {
  return {
    contextId: "cctx_123",
    executionCount: 2,
    language: "python",
    outputs: [
      { format: "text", kind: "inline", value: "hello" },
      { format: "json", kind: "inline", value: { ok: true } },
      {
        artifactId: "art_123",
        contentType: "image/png",
        format: "png",
        kind: "artifact",
        sizeBytes: 42,
      },
      {
        format: "svg",
        kind: "rejected",
        reason: "requires_artifact_promotion",
      },
    ],
    sandboxId: "sbx_code",
    stderr: "warn",
    stdout: "out",
  };
}

function shortErrorResult() {
  return {
    contextId: "cctx_123",
    error: {
      message: "boom",
      name: "ValueError",
      traceback: ["line 1", "line 2"],
    },
    executionCount: 1,
    language: "python",
    outputs: [],
    sandboxId: "sbx_code",
    stderr: "",
    stdout: "",
  };
}

function longErrorResult() {
  return {
    contextId: "cctx_123",
    error: { message: "x".repeat(2_100) },
    executionCount: 1,
    language: "python",
    outputs: [],
    sandboxId: "sbx_code",
    stderr: "",
    stdout: "",
  };
}
