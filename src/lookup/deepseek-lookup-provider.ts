import { lookupProviderConfig } from '../config/runtime/index.js';
import type { AppLogger } from '../logging/logger.js';
import type {
  LookupProvider,
  LookupProviderSearchInput,
  LookupProviderSearchResult,
  LookupSource
} from './types.js';

export class DeepSeekLookupProvider implements LookupProvider {
  constructor(
    private readonly config: {
      apiKey: string;
      fallback: LookupProvider | null;
      logger: AppLogger;
    }
  ) {}

  async search(
    input: LookupProviderSearchInput
  ): Promise<LookupProviderSearchResult> {
    let failure: Error;
    try {
      const result = await this.searchDeepSeek(input);
      if (result.sources.length > 0) return result;

      failure = new Error('DeepSeek Search returned no usable results');
    } catch (error) {
      failure = error instanceof Error ? error : new Error(String(error));
    }

    this.config.logger.warn('deepseek_search_fallback', {
      errorMessage: `${failure.message}. ${this.config.fallback ? 'Trying Tavily.' : 'Tavily fallback is not configured.'}`
    });
    if (this.config.fallback) return this.config.fallback.search(input);

    throw failure;
  }

  private async searchDeepSeek(
    input: LookupProviderSearchInput
  ): Promise<LookupProviderSearchResult> {
    if (
      !input.query.trim() ||
      [...input.query].length > lookupProviderConfig.deepseek.maxQueryChars
    )
      throw new Error(
        `DeepSeek Search query must contain 1 to ${lookupProviderConfig.deepseek.maxQueryChars} Unicode characters`
      );

    const started = Date.now();
    const response = await fetch(lookupProviderConfig.deepseek.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        query: input.query,
        count: input.maxResults,
        need_content: false
      }),
      signal: AbortSignal.timeout(input.timeoutMs)
    });
    if (!response.ok)
      throw new Error(`DeepSeek Search failed with status ${response.status}`);

    let payload: { results?: unknown };
    try {
      payload = (await response.json()) as { results?: unknown };
    } catch {
      throw new Error('DeepSeek Search returned invalid JSON');
    }

    return {
      provider: 'deepseek',
      query: input.query,
      sources: normalizeResults(payload?.results).slice(0, input.maxResults),
      responseTimeMs: Date.now() - started,
      usageCredits: null
    };
  }
}

function normalizeResults(value: unknown): LookupSource[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((row: unknown): LookupSource[] => {
    if (!row || typeof row !== 'object') return [];

    const item = row as {
      title?: unknown;
      url?: unknown;
      summary?: unknown;
      snippet?: unknown;
      rerank_score?: unknown;
    };
    const content = isText(item.summary) ? item.summary : item.snippet;
    if (!isText(item.title) || !isText(item.url) || !isText(content)) return [];

    return [
      {
        title: item.title,
        url: item.url,
        content,
        score:
          typeof item.rerank_score === 'number' &&
          Number.isFinite(item.rerank_score)
            ? item.rerank_score
            : null
      }
    ];
  });
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
