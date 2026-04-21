import type { TranscriptArtifact, VisionArtifact } from './types.js';

const VISION_KINDS = new Set<VisionArtifact['kind']>([
  'photo',
  'screenshot',
  'meme',
  'document',
  'other'
]);

export function normalizeCloudflareVisionResponse(
  input: unknown
): VisionArtifact {
  const payload = unwrapCloudflareVisionPayload(input);

  return {
    type: 'vision',
    kind: normalizeVisionKind(readOptionalString(payload, 'kind')),
    visibleText: readStringArray(payload, 'visibleText', 'visible_text'),
    namesMentionedInText: readStringArray(
      payload,
      'namesMentionedInText',
      'names_mentioned_in_text'
    ),
    visuallyPresentPeopleOrCharacters: readStringArray(
      payload,
      'visuallyPresentPeopleOrCharacters',
      'visually_present_people_or_characters'
    ),
    objects: readStringArray(payload, 'objects'),
    scene: readString(payload, 'scene'),
    actions: readStringArray(payload, 'actions'),
    style: readString(payload, 'style'),
    uncertainty: readStringArray(payload, 'uncertainty')
  };
}

export function normalizeGladiaTranscriptionResult(
  input: unknown
): TranscriptArtifact {
  const payload = unwrapGladiaPayload(input);

  return {
    type: 'transcript',
    transcript:
      readOptionalString(payload, 'transcript') ??
      readOptionalString(
        getRecord(payload, 'transcription'),
        'transcript',
        'full_transcript'
      ) ??
      readOptionalString(
        getRecord(payload, 'result'),
        'transcript',
        'full_transcript'
      ) ??
      readOptionalString(
        getRecord(getRecord(payload, 'result'), 'transcription'),
        'transcript',
        'full_transcript'
      ) ??
      '',
    language:
      readOptionalString(payload, 'language') ??
      readOptionalString(getRecord(payload, 'metadata'), 'language') ??
      readOptionalString(getRecord(payload, 'audio_metadata'), 'language') ??
      readOptionalString(getRecord(payload, 'audioMetadata'), 'language') ??
      readOptionalString(getRecord(payload, 'result'), 'language') ??
      readOptionalString(
        getRecord(getRecord(payload, 'result'), 'metadata'),
        'language'
      ) ??
      readOptionalString(
        getRecord(getRecord(payload, 'result'), 'audio_metadata'),
        'language'
      ) ??
      readOptionalString(
        getRecord(getRecord(payload, 'result'), 'audioMetadata'),
        'language'
      ) ??
      null,
    duration: readDuration(payload)
  };
}

function unwrapCloudflareVisionPayload(
  input: unknown
): Record<string, unknown> {
  const parsed = parseJsonIfString(input);

  if (!isRecord(parsed)) {
    return {};
  }

  if (looksLikeVisionPayload(parsed)) {
    return parsed;
  }

  for (const key of [
    'response',
    'result',
    'output',
    'data',
    'body',
    'payload',
    'message'
  ] as const) {
    const nested = parsed[key];
    const unwrapped = unwrapCloudflareVisionPayload(nested);

    if (looksLikeVisionPayload(unwrapped)) {
      return unwrapped;
    }
  }

  return parsed;
}

function unwrapGladiaPayload(input: unknown): Record<string, unknown> {
  const parsed = parseJsonIfString(input);

  if (!isRecord(parsed)) {
    return {};
  }

  if (looksLikeGladiaPayload(parsed)) {
    return parsed;
  }

  for (const key of [
    'result',
    'response',
    'data',
    'body',
    'payload',
    'message'
  ] as const) {
    const nested = parsed[key];
    const unwrapped = unwrapGladiaPayload(nested);

    if (looksLikeGladiaPayload(unwrapped)) {
      return unwrapped;
    }
  }

  return parsed;
}

function looksLikeVisionPayload(value: Record<string, unknown>): boolean {
  return (
    'kind' in value ||
    'visible_text' in value ||
    'visibleText' in value ||
    'names_mentioned_in_text' in value ||
    'namesMentionedInText' in value ||
    'visually_present_people_or_characters' in value ||
    'visuallyPresentPeopleOrCharacters' in value ||
    'objects' in value ||
    'scene' in value ||
    'actions' in value ||
    'style' in value ||
    'uncertainty' in value
  );
}

function looksLikeGladiaPayload(value: Record<string, unknown>): boolean {
  return (
    'transcript' in value ||
    'language' in value ||
    'result' in value ||
    'metadata' in value ||
    'transcription' in value ||
    'audio_metadata' in value ||
    'audioMetadata' in value
  );
}

function normalizeVisionKind(value: string | null): VisionArtifact['kind'] {
  if (value && VISION_KINDS.has(value as VisionArtifact['kind'])) {
    return value as VisionArtifact['kind'];
  }

  return 'other';
}

function readString(value: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const candidate = value[key];

    if (typeof candidate === 'string') {
      return candidate;
    }
  }

  return '';
}

function readOptionalString(
  value: Record<string, unknown>,
  ...keys: string[]
): string | null {
  for (const key of keys) {
    const candidate = value[key];

    if (typeof candidate === 'string') {
      return candidate;
    }
  }

  return null;
}

function readStringArray(
  value: Record<string, unknown>,
  ...keys: string[]
): string[] {
  for (const key of keys) {
    const candidate = value[key];

    if (Array.isArray(candidate)) {
      return candidate.filter(
        (item): item is string => typeof item === 'string'
      );
    }
  }

  return [];
}

function readDuration(value: Record<string, unknown>): number | null {
  const metadata = getRecord(value, 'metadata');
  const audioMetadata =
    getRecord(value, 'audio_metadata') ?? getRecord(value, 'audioMetadata');
  const result = getRecord(value, 'result');
  const resultMetadata = getRecord(result, 'metadata');
  const transcription = getRecord(result, 'transcription');
  const resultAudioMetadata =
    getRecord(result, 'audio_metadata') ?? getRecord(result, 'audioMetadata');

  const candidates = [
    value.duration,
    value.source_duration_seconds,
    metadata.duration,
    metadata.audio_duration,
    audioMetadata.duration,
    audioMetadata.audio_duration,
    result.duration,
    resultMetadata.duration,
    resultMetadata.audio_duration,
    transcription.duration,
    resultAudioMetadata.duration,
    resultAudioMetadata.audio_duration
  ];

  for (const candidate of candidates) {
    const duration = toFiniteNumber(candidate);

    if (duration !== null) {
      return duration;
    }
  }

  return null;
}

function getRecord(
  value: Record<string, unknown> | null | undefined,
  key: string
): Record<string, unknown> {
  const candidate = value?.[key];

  return isRecord(candidate) ? candidate : {};
}

function parseJsonIfString(input: unknown): unknown {
  if (typeof input !== 'string') {
    return input;
  }

  try {
    return JSON.parse(input);
  } catch {
    return {};
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  return value;
}
