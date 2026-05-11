import { lookupProviderConfig } from '../config/runtime/index.js';
import type {
  LookupProvider,
  LookupProviderSearchInput,
  LookupProviderSearchResult,
  LookupSource
} from './types.js';

type TavilySearchResponse = {
  results?: unknown;
  response_time?: number;
  usage?: {
    credits?: number;
  };
};

export class TavilyLookupProvider implements LookupProvider {
  constructor(private readonly config: { apiKey: string }) {}

  async search(
    input: LookupProviderSearchInput
  ): Promise<LookupProviderSearchResult> {
    const response = await fetch(lookupProviderConfig.tavily.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        query: input.query,
        search_depth: lookupProviderConfig.tavily.searchDepth,
        max_results: input.maxResults,
        include_answer: lookupProviderConfig.tavily.includeAnswer,
        include_raw_content: lookupProviderConfig.tavily.includeRawContent,
        include_usage: lookupProviderConfig.tavily.includeUsage
      }),
      signal: AbortSignal.timeout(input.timeoutMs)
    });

    if (!response.ok) {
      const errorBody = (await response.text()).trim();
      const errorMessage =
        errorBody.length > 0 ? errorBody : response.statusText;

      throw new Error(
        `Tavily lookup failed with status ${response.status}: ${errorMessage}`
      );
    }

    const payload = (await response.json()) as TavilySearchResponse;

    return {
      provider: lookupProviderConfig.provider,
      query: input.query,
      sources: normalizeResults(payload.results),
      responseTimeMs: toMilliseconds(payload.response_time),
      usageCredits: toNullableNumber(payload.usage?.credits)
    };
  }
}

function normalizeResults(value: unknown): LookupSource[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap(normalizeResultRow);
}

function normalizeResultRow(row: unknown): LookupSource[] {
  if (!row || typeof row !== 'object') {
    return [];
  }

  const candidate = row as Partial<LookupSource>;

  if (
    !isNonEmptyString(candidate.title) ||
    !isNonEmptyString(candidate.url) ||
    !isNonEmptyString(candidate.content)
  ) {
    return [];
  }

  return [
    {
      title: candidate.title,
      url: candidate.url,
      content: candidate.content,
      score: toNullableNumber(candidate.score)
    }
  ];
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function toNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function toMilliseconds(value: unknown): number | null {
  const seconds = toNullableNumber(value);

  return seconds === null ? null : Math.round(seconds * 1000);
}
