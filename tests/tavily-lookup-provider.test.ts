import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";

import { TavilyLookupProvider } from "../src/lookup/tavily-lookup-provider.js";

describe("TavilyLookupProvider", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    globalThis.fetch = originalFetch;
  });

  test("calls tavily search with expected request and normalizes results", async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              title: "OpenAI",
              url: "https://openai.com",
              content: "AI company",
              score: 0.91
            }
          ],
          response_time: 1.234,
          usage: {
            credits: 2
          }
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      )
    );

    const provider = new TavilyLookupProvider({ apiKey: "tvly-key" });
    const result = await provider.search({
      query: "openai",
      maxResults: 3,
      timeoutMs: 5000
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.tavily.com/search",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer tvly-key",
          "content-type": "application/json"
        }),
        body: JSON.stringify({
          query: "openai",
          search_depth: "basic",
          max_results: 3,
          include_answer: false,
          include_raw_content: false,
          include_usage: true
        }),
        signal: expect.any(AbortSignal)
      })
    );
    expect(result).toEqual({
      provider: "tavily",
      query: "openai",
      sources: [
        {
          title: "OpenAI",
          url: "https://openai.com",
          content: "AI company",
          score: 0.91
        }
      ],
      responseTimeMs: 1234,
      usageCredits: 2
    });
  });

  test("throws on non-2xx responses", async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValue(
      new Response("bad key", {
        status: 401,
        statusText: "Unauthorized"
      })
    );

    const provider = new TavilyLookupProvider({ apiKey: "bad-key" });

    await expect(
      provider.search({
        query: "openai",
        maxResults: 3,
        timeoutMs: 5000
      })
    ).rejects.toThrow("Tavily lookup failed with status 401: bad key");
  });

  test("drops malformed rows and nulls missing metrics", async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              title: "Valid",
              url: "https://example.com",
              content: "keep",
              score: null
            },
            {
              title: "",
              url: "https://example.com/missing-title",
              content: "drop"
            },
            {
              title: "Missing url",
              content: "drop"
            },
            {
              title: "Missing content",
              url: "https://example.com/missing-content"
            }
          ]
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      )
    );

    const provider = new TavilyLookupProvider({ apiKey: "tvly-key" });
    const result = await provider.search({
      query: "openai",
      maxResults: 3,
      timeoutMs: 5000
    });

    expect(result.sources).toEqual([
      {
        title: "Valid",
        url: "https://example.com",
        content: "keep",
        score: null
      }
    ]);
    expect(result.responseTimeMs).toBeNull();
    expect(result.usageCredits).toBeNull();
  });

  test("treats malformed results containers as no sources", async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: {}
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json"
            }
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: [null]
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json"
            }
          }
        )
      );

    const provider = new TavilyLookupProvider({ apiKey: "tvly-key" });

    await expect(
      provider.search({
        query: "openai",
        maxResults: 3,
        timeoutMs: 5000
      })
    ).resolves.toMatchObject({
      sources: []
    });
    await expect(
      provider.search({
        query: "openai",
        maxResults: 3,
        timeoutMs: 5000
      })
    ).resolves.toMatchObject({
      sources: []
    });
  });
});
