import { readFile } from 'node:fs/promises';

import { mediaProviderConfig } from '../config/runtime/index.js';
import { normalizeGladiaTranscriptionResult } from './normalize.js';
import type { SpeechToTextProvider } from './types.js';

type GladiaUploadResponse = {
  audio_url?: unknown;
  audioUrl?: unknown;
  audio_metadata?: {
    audio_duration?: unknown;
    duration?: unknown;
  };
  audioMetadata?: {
    audio_duration?: unknown;
    duration?: unknown;
  };
  source_duration_seconds?: unknown;
  sourceDurationSeconds?: unknown;
  duration?: unknown;
};

type GladiaJobResponse = {
  id?: unknown;
  job_id?: unknown;
  result_url?: unknown;
  resultUrl?: unknown;
};

type GladiaPollResponse = {
  status?: unknown;
};

const GLADIA_UPLOAD_URL = mediaProviderConfig.gladia.uploadUrl;
const GLADIA_PRE_RECORDED_URL = mediaProviderConfig.gladia.preRecordedUrl;
const GLADIA_PROVIDER_MODEL = mediaProviderConfig.gladia.model;

export class GladiaTranscriptionProvider implements SpeechToTextProvider {
  constructor(
    private readonly config: {
      apiKey: string;
      fetch?: typeof fetch;
      delay?: (ms: number) => Promise<void>;
      pollIntervalMs?: number;
      maxPollAttempts?: number;
    }
  ) {}

  async transcribe(input: {
    filePath: string;
    filename: string;
    mimeType: string;
    timeoutMs: number;
  }): Promise<{
    provider: 'gladia';
    providerModel: string;
    artifact: ReturnType<typeof normalizeGladiaTranscriptionResult>;
    rawResponse: unknown;
    sourceDurationSeconds: number | null;
  }> {
    const fetchImpl = this.config.fetch ?? globalThis.fetch;
    const pollIntervalMs =
      this.config.pollIntervalMs ?? mediaProviderConfig.gladia.pollIntervalMs;
    const maxPollAttempts =
      this.config.maxPollAttempts ?? mediaProviderConfig.gladia.maxPollAttempts;
    const deadlineMs = Date.now() + input.timeoutMs;
    const delay =
      this.config.delay ??
      (async (ms: number) => {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, ms);
        });
      });

    const uploadPayload = await this.postJson<GladiaUploadResponse>(
      fetchImpl,
      GLADIA_UPLOAD_URL,
      deadlineMs,
      input.timeoutMs,
      await this.buildUploadBody(input)
    );

    const audioUrl = readString(uploadPayload, 'audio_url', 'audioUrl');

    if (!audioUrl) {
      throw new Error('Gladia upload response was missing audio_url.');
    }

    const sourceDurationSeconds = readDuration(uploadPayload);

    const jobPayload = await this.postJson<GladiaJobResponse>(
      fetchImpl,
      GLADIA_PRE_RECORDED_URL,
      deadlineMs,
      input.timeoutMs,
      JSON.stringify({ audio_url: audioUrl, detect_language: true })
    );

    const jobId = readString(jobPayload, 'id', 'job_id');
    const resultUrl = readString(jobPayload, 'result_url', 'resultUrl');

    if (!jobId && !resultUrl) {
      throw new Error(
        'Gladia transcription job response was missing an id and result_url.'
      );
    }

    const rawResponse = await this.pollForResult({
      fetchImpl,
      deadlineMs,
      totalTimeoutMs: input.timeoutMs,
      pollIntervalMs,
      maxPollAttempts,
      delay,
      pollUrl:
        resultUrl.length > 0 ? resultUrl : `${GLADIA_PRE_RECORDED_URL}/${jobId}`
    });

    const artifact = normalizeGladiaTranscriptionResult(rawResponse);

    return {
      provider: mediaProviderConfig.gladia.provider,
      providerModel: GLADIA_PROVIDER_MODEL,
      artifact,
      rawResponse,
      sourceDurationSeconds: sourceDurationSeconds ?? artifact.duration
    };
  }

  private async buildUploadBody(input: {
    filePath: string;
    filename: string;
    mimeType: string;
  }): Promise<FormData> {
    const bytes = await readFile(input.filePath);
    const form = new FormData();
    form.set(
      'audio',
      new Blob([bytes], { type: input.mimeType }),
      input.filename
    );

    return form;
  }

  private async postJson<T>(
    fetchImpl: typeof fetch,
    url: string,
    deadlineMs: number,
    totalTimeoutMs: number,
    body: BodyInit
  ): Promise<T> {
    const headers: Record<string, string> = {
      'x-gladia-key': this.config.apiKey
    };

    if (typeof body === 'string') {
      headers['content-type'] = 'application/json';
    }

    const response = await this.fetchWithTimeout(
      fetchImpl,
      url,
      {
        method: 'POST',
        headers,
        body
      },
      getRemainingTimeoutMs(deadlineMs, totalTimeoutMs)
    );

    return this.readJsonResponse<T>(response, 'POST', url);
  }

  private async pollForResult(input: {
    fetchImpl: typeof fetch;
    deadlineMs: number;
    totalTimeoutMs: number;
    pollIntervalMs: number;
    maxPollAttempts: number;
    delay: (ms: number) => Promise<void>;
    pollUrl: string;
  }): Promise<unknown> {
    for (let attempt = 1; attempt <= input.maxPollAttempts; attempt += 1) {
      const response = await this.fetchWithTimeout(
        input.fetchImpl,
        input.pollUrl,
        {
          method: 'GET',
          headers: {
            'x-gladia-key': this.config.apiKey
          }
        },
        getRemainingTimeoutMs(input.deadlineMs, input.totalTimeoutMs)
      );

      const payload = await this.readJsonResponse<GladiaPollResponse>(
        response,
        'GET',
        input.pollUrl
      );
      const status = readString(payload, 'status');

      if (status === 'done') {
        return payload;
      }

      if (status === 'error' || status === 'failed') {
        throw new Error(
          `Gladia transcription job failed with status ${status}.`
        );
      }

      if (attempt < input.maxPollAttempts) {
        if (Date.now() + input.pollIntervalMs > input.deadlineMs) {
          throw createTotalTimeoutError(input.totalTimeoutMs);
        }

        await input.delay(input.pollIntervalMs);
      }
    }

    throw new Error(
      `Timed out waiting for Gladia transcription after ${input.maxPollAttempts} polling attempts.`
    );
  }

  private async fetchWithTimeout(
    fetchImpl: typeof fetch,
    url: string,
    init: RequestInit,
    timeoutMs: number
  ): Promise<Response> {
    const { signal, clear } = createTimeoutSignal(timeoutMs);

    try {
      return await fetchImpl(url, {
        ...init,
        signal
      });
    } finally {
      clear();
    }
  }

  private async readJsonResponse<T>(
    response: Response,
    method: string,
    url: string
  ): Promise<T> {
    if (!response.ok) {
      const errorBody = (await response.text()).trim();
      const errorMessage =
        errorBody.length > 0 ? errorBody : response.statusText;

      throw new Error(
        `Gladia ${method} ${url} failed with status ${response.status}: ${errorMessage}`
      );
    }

    const text = (await response.text()).trim();

    if (text.length === 0) {
      return {} as T;
    }

    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(`Gladia ${method} ${url} returned invalid JSON.`);
    }
  }
}

function getRemainingTimeoutMs(
  deadlineMs: number,
  totalTimeoutMs: number
): number {
  const remainingMs = deadlineMs - Date.now();

  if (remainingMs <= 0) {
    throw createTotalTimeoutError(totalTimeoutMs);
  }

  return remainingMs;
}

function createTotalTimeoutError(timeoutMs: number): Error {
  return new Error(
    `Timed out waiting for Gladia transcription after ${timeoutMs}ms.`
  );
}

function createTimeoutSignal(timeoutMs: number): {
  signal: AbortSignal;
  clear: () => void;
} {
  const timeoutFactory = AbortSignal.timeout;

  if (typeof timeoutFactory === 'function') {
    return {
      signal: timeoutFactory(timeoutMs),
      clear: () => undefined
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  return {
    signal: controller.signal,
    clear: () => {
      clearTimeout(timer);
    }
  };
}

function readString(value: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const candidate = value[key];

    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate;
    }
  }

  return '';
}

function readDuration(value: GladiaUploadResponse): number | null {
  const candidates = [
    value.audio_metadata?.audio_duration,
    value.audio_metadata?.duration,
    value.audioMetadata?.audio_duration,
    value.audioMetadata?.duration,
    value.source_duration_seconds,
    value.sourceDurationSeconds,
    value.duration
  ];

  for (const candidate of candidates) {
    const duration = toFiniteNumber(candidate);

    if (duration !== null) {
      return duration;
    }
  }

  return null;
}

function toFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
