import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';

import { mediaProviderConfig } from '../config/runtime/index.js';
import type { OcrProvider } from './types.js';

const OCR_SPACE_ENDPOINT = mediaProviderConfig.ocrSpace.endpoint;
const OCR_SPACE_PROVIDER_MODEL = mediaProviderConfig.ocrSpace.model;

export class OcrSpaceProvider implements OcrProvider {
  constructor(
    private readonly config: {
      apiKey: string;
      fetch?: typeof fetch;
    }
  ) {}

  async extractText(input: {
    filePath: string;
    language: 'rus' | null;
    timeoutMs: number;
  }): Promise<{
    provider: 'ocr_space';
    providerModel: string;
    text: string;
    language: 'rus' | null;
    rawResponse: unknown;
  }> {
    const fetchImpl = this.config.fetch ?? globalThis.fetch;
    const formData = await this.buildRequestBody(
      input.filePath,
      input.language
    );
    const { signal, clear } = createTimeoutSignal(input.timeoutMs);
    let response: Response;

    try {
      response = await fetchImpl(OCR_SPACE_ENDPOINT, {
        method: 'POST',
        headers: {
          apikey: this.config.apiKey
        },
        body: formData,
        signal
      });
    } finally {
      clear();
    }

    if (!response.ok) {
      const errorText = (await response.text()).trim();
      throw new Error(
        `OCR.space request failed with status ${response.status}: ${errorText.length > 0 ? errorText : response.statusText}`
      );
    }

    const rawResponse = await this.readJsonResponse(response);
    ensureOcrSpaceSuccess(rawResponse);

    const text = extractOcrSpaceText(rawResponse);

    return {
      provider: mediaProviderConfig.ocrSpace.provider,
      providerModel: OCR_SPACE_PROVIDER_MODEL,
      text,
      language: input.language,
      rawResponse
    };
  }

  private async buildRequestBody(
    filePath: string,
    language: 'rus' | null
  ): Promise<FormData> {
    const bytes = await readFile(filePath);
    const filename = basename(filePath);
    const blobType = getOcrSpaceBlobType(filename);
    const form = new FormData();

    form.set('file', new Blob([bytes], { type: blobType }), filename);
    form.set('OCREngine', mediaProviderConfig.ocrSpace.engine);

    if (language === 'rus') {
      form.set('language', 'rus');
    }

    return form;
  }

  private async readJsonResponse(response: Response): Promise<unknown> {
    const text = (await response.text()).trim();

    if (text.length === 0) {
      throw new Error('OCR.space request returned an empty response.');
    }

    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new Error('OCR.space request returned invalid JSON.');
    }
  }
}

function extractOcrSpaceText(input: unknown): string {
  if (!isRecord(input)) {
    return '';
  }

  const parsedResults = Array.isArray(input.ParsedResults)
    ? input.ParsedResults
    : [];
  const text = parsedResults
    .map((result) =>
      typeof result?.ParsedText === 'string' ? result.ParsedText.trim() : ''
    )
    .filter((value): value is string => value.length > 0)
    .join('\n')
    .trim();

  return text;
}

function ensureOcrSpaceSuccess(input: unknown): void {
  if (!isRecord(input)) {
    return;
  }

  const details = collectOcrSpaceFailureDetails(input);
  const ocrExitCode = getNumericValue(input.OCRExitCode);

  if (input.IsErroredOnProcessing === true) {
    throw new Error(
      `OCR.space processing error: ${formatOcrSpaceFailureDetails(details, ocrExitCode)}`
    );
  }

  if (details.length > 0) {
    throw new Error(
      `OCR.space processing error: ${formatOcrSpaceFailureDetails(details, ocrExitCode)}`
    );
  }

  if (ocrExitCode !== undefined && ocrExitCode !== 1) {
    throw new Error(
      `OCR.space processing error: ${formatOcrSpaceFailureDetails(details, ocrExitCode)}`
    );
  }
}

function collectOcrSpaceFailureDetails(
  input: Record<string, unknown>
): string[] {
  const messages = [
    ...collectStrings(input.ErrorMessage),
    ...collectStrings(input.ErrorDetails)
  ];

  const parsedResults = Array.isArray(input.ParsedResults)
    ? input.ParsedResults
    : [];

  for (const result of parsedResults) {
    if (!isRecord(result)) {
      continue;
    }

    messages.push(
      ...collectStrings(result.ErrorMessage),
      ...collectStrings(result.ErrorDetails)
    );
  }

  return messages;
}

function formatOcrSpaceFailureDetails(
  details: string[],
  ocrExitCode: number | undefined
): string {
  if (details.length > 0) {
    return details.join('; ');
  }

  if (ocrExitCode !== undefined) {
    return `OCRExitCode ${ocrExitCode}`;
  }

  return 'OCR.space reported a processing failure.';
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

function collectStrings(value: unknown): string[] {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? [trimmed] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectStrings(item));
  }

  return [];
}

function getNumericValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function getOcrSpaceBlobType(filename: string): string {
  switch (extname(filename).toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    default:
      return 'application/octet-stream';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
