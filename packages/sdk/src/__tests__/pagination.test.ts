import { describe, expect, it, vi } from "vitest";

import { createCrowNestClient } from "../index";

describe("automatic pagination", () => {
  it("retains the response envelope and iterates all pages", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ data: [{ id: "prj_1" }], hasMore: true, nextCursor: "page-2" }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: "prj_2" }], hasMore: false }));
    const client = createCrowNestClient({
      apiKey: "cnk_test_key",
      baseUrl: "https://api.test",
      fetch: fetchMock,
    });

    const first = await client.projects.list({ limit: 1 });
    expect(first).toEqual({
      data: [{ id: "prj_1" }],
      hasMore: true,
      nextCursor: "page-2",
    });
    expect(typeof first.nextPage).toBe("function");

    const ids = [];
    for await (const project of first) ids.push(project.id);

    expect(ids).toEqual(["prj_1", "prj_2"]);
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "https://api.test/v1/projects?limit=1",
      "https://api.test/v1/projects?limit=1&cursor=page-2",
    ]);
  });

  it("rejects a broken hasMore response instead of looping forever", async () => {
    const client = createCrowNestClient({
      apiKey: "cnk_test_key",
      fetch: vi.fn().mockResolvedValue(jsonResponse({ data: [], hasMore: true })),
    });

    const page = await client.apiKeys.list();
    await expect(page.nextPage()).rejects.toThrow(/without a nextCursor/);
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  });
}
