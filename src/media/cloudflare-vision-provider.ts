import { readFile } from 'node:fs/promises';

import { loadPrompt } from '../llm/prompt-files.js';
import type { VisionProvider } from './types.js';

const CLOUDFLARE_VISION_PROVIDER_MODEL =
  '@cf/meta/llama-3.2-11b-vision-instruct';
const CLOUDFLARE_VISION_ENDPOINT =
  'https://api.cloudflare.com/client/v4/accounts';

export class CloudflareVisionProvider implements VisionProvider {
  constructor(
    private readonly config: {
      accountId: string;
      apiKey: string;
      fetch?: typeof fetch;
    }
  ) {}

  async describe(input: { filePath: string; timeoutMs: number }): Promise<{
    provider: 'cloudflare';
    providerModel: string;
    rawText: string;
    rawResponse: unknown;
  }> {
    const fetchImpl = this.config.fetch ?? globalThis.fetch;
    const body = await this.buildRequestBody(input.filePath);
    const { signal, clear } = createTimeoutSignal(input.timeoutMs);
    let response: Response;

    try {
      response = await fetchImpl(this.getEndpointUrl(), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.config.apiKey}`,
          'content-type': 'application/json'
        },
        body,
        signal
      });
    } finally {
      clear();
    }

    if (!response.ok) {
      const errorText = (await response.text()).trim();
      throw new Error(
        `Cloudflare vision request failed with status ${response.status}: ${formatCloudflareFailureDetails(errorText.length > 0 ? errorText : response.statusText, response.statusText)}`
      );
    }

    const rawResponse = await this.readJsonResponse(response);
    const responseBody = selectCloudflareResponseBody(rawResponse);

    ensureCloudflareSuccess(rawResponse);

    const rawText = extractCloudflareVisionText(responseBody);

    return {
      provider: 'cloudflare',
      providerModel: CLOUDFLARE_VISION_PROVIDER_MODEL,
      rawText,
      rawResponse
    };
  }

  private getEndpointUrl(): string {
    return `${CLOUDFLARE_VISION_ENDPOINT}/${this.config.accountId}/ai/run/${CLOUDFLARE_VISION_PROVIDER_MODEL}`;
  }

  private async buildRequestBody(filePath: string): Promise<string> {
    const bytes = await readFile(filePath);

    return JSON.stringify({
      prompt: loadPrompt('cloudflareVisionImageRawUser'),
      image: Array.from(bytes),
      max_tokens: 700,
      temperature: 0
    });
  }

  private async readJsonResponse(response: Response): Promise<unknown> {
    const text = (await response.text()).trim();

    if (text.length === 0) {
      throw new Error('Cloudflare vision request returned an empty response.');
    }

    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new Error('Cloudflare vision request returned invalid JSON.');
    }
  }
}

function extractCloudflareVisionText(input: unknown): string {
  if (typeof input === 'string') {
    const trimmed = input.trim();

    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  if (
    typeof input === 'object' &&
    input !== null &&
    'response' in input &&
    typeof input.response === 'string'
  ) {
    const trimmed = input.response.trim();

    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  throw new Error('Cloudflare vision request returned empty text content.');
}

function createTimeoutSignal(timeoutMs: number): {
  signal: AbortSignal;
  clear: () => void;
} {
  if (typeof AbortSignal.timeout === 'function') {
    return {
      signal: AbortSignal.timeout(timeoutMs),
      clear: () => undefined
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer)
  };
}

function selectCloudflareResponseBody(input: unknown): unknown {
  if (!isRecord(input)) {
    return input;
  }

  const result = input.result;

  if (isRecord(result) && 'response' in result) {
    return result.response;
  }

  if ('response' in input) {
    return input.response;
  }

  if ('result' in input) {
    return input.result;
  }

  if ('body' in input) {
    return input.body;
  }

  return input;
}

function ensureCloudflareSuccess(input: unknown): void {
  if (!isRecord(input)) {
    return;
  }

  if ('success' in input && input.success === false) {
    throw new Error(
      `Cloudflare vision request reported success=false: ${formatCloudflareFailureDetails(input, 'Cloudflare request failed')}`
    );
  }

  if (Array.isArray(input.errors) && input.errors.length > 0) {
    throw new Error(
      `Cloudflare vision request returned errors: ${formatCloudflareFailureDetails(input, 'Cloudflare request failed')}`
    );
  }
}

function formatCloudflareFailureDetails(
  input: unknown,
  fallback: string
): string {
  if (typeof input === 'string') {
    return input.trim().length > 0 ? input.trim() : fallback;
  }

  if (!isRecord(input)) {
    return fallback;
  }

  if (Array.isArray(input.errors) && input.errors.length > 0) {
    const messages = input.errors
      .map((error) => formatCloudflareError(error))
      .filter((value): value is string => value.length > 0);

    if (messages.length > 0) {
      return messages.join('; ');
    }
  }

  if (typeof input.error === 'string' && input.error.trim().length > 0) {
    return input.error.trim();
  }

  if (typeof input.message === 'string' && input.message.trim().length > 0) {
    return input.message.trim();
  }

  return fallback;
}

function formatCloudflareError(error: unknown): string {
  if (typeof error === 'string') {
    return error.trim();
  }

  if (!isRecord(error)) {
    return '';
  }

  const parts = [
    toNonEmptyString(error.message),
    toNonEmptyString(error.error),
    toNonEmptyString(error.code),
    toNonEmptyString(error.detail)
  ].filter((value): value is string => value.length > 0);

  return parts.join(' ').trim();
}

function toNonEmptyString(value: unknown): string {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : typeof value === 'number' && Number.isFinite(value)
      ? String(value)
      : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
