export const mediaProviderConfig = {
  maxFileBytes: 10_000_000,
  nearbyScanLimit: 10,
  artifactKinds: {
    imageDescription: 'vision_description',
    ocrTextRu: 'ocr_text_ru',
    ocrTextDefault: 'ocr_text_default',
    imageInterpretation: 'vision_interpretation',
    autoReadFailed: 'auto_read'
  },
  providers: {
    imageDescription: 'cloudflare',
    imageInterpretation: 'deepseek',
    ocr: 'ocr_space',
    stt: 'gladia',
    autoReadFailed: 'auto_read'
  },
  autoRead: {
    maxAttempts: 2,
    albumImageDedupeTtlMs: 24 * 60 * 60 * 1000,
    failedModel: 'auto_read',
    failedErrorTextMaxLength: 500
  },
  cloudflareVision: {
    provider: 'cloudflare',
    endpoint: 'https://api.cloudflare.com/client/v4/accounts',
    model: '@cf/meta/llama-3.2-11b-vision-instruct',
    maxTokens: 700,
    temperature: 0
  },
  gladia: {
    provider: 'gladia',
    uploadUrl: 'https://api.gladia.io/v2/upload',
    preRecordedUrl: 'https://api.gladia.io/v2/pre-recorded',
    model: 'gladia-v2-pre-recorded',
    pollIntervalMs: 1000,
    maxPollAttempts: 30
  },
  ocrSpace: {
    provider: 'ocr_space',
    endpoint: 'https://api.ocr.space/parse/image',
    model: 'ocr.space/parse/image:OCREngine=2',
    engine: '2'
  },
  telegram: {
    fileEndpointBase: 'https://api.telegram.org/file',
    fileDownloadTimeoutMs: 30_000
  },
  emptyOcrResultMarker: 'empty_result'
} as const;
