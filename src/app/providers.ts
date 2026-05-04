import type { AppEnv } from '../config/env/index.js';
import { OpenAiCompatibleLlmClient } from '../llm/openai-compatible-client/index.js';
import type { AppLogger } from '../logging/logger.js';
import { TavilyLookupProvider } from '../lookup/tavily-lookup-provider.js';
import type { LookupProvider } from '../lookup/types.js';
import { CloudflareVisionProvider } from '../media/cloudflare-vision-provider.js';
import { GladiaTranscriptionProvider } from '../media/gladia-transcription-provider.js';
import { OcrSpaceProvider } from '../media/ocr-space-provider.js';
import type {
  OcrProvider,
  SpeechToTextProvider,
  TextToSpeechProvider,
  VisionProvider
} from '../media/types.js';
import { YandexSpeechKitTtsProvider } from '../tts/yandex-speechkit-provider.js';

export type OptionalProviders = {
  lookupProvider: LookupProvider | null;
  speechToTextProvider: SpeechToTextProvider | null;
  textToSpeechProvider: TextToSpeechProvider | null;
  ocrProvider: OcrProvider | null;
  visionProvider: VisionProvider | null;
};

export function createLlmClient(input: {
  env: AppEnv;
  logger: AppLogger;
}): OpenAiCompatibleLlmClient {
  return new OpenAiCompatibleLlmClient(
    {
      apiKey: input.env.llmApiKey,
      baseUrl: input.env.llmBaseUrl,
      replyModel: input.env.llmReplyModel,
      replyTemperature: input.env.llmReplyTemperature,
      plannerModel: input.env.llmPlannerModel,
      lookupMaxQueries: input.env.lookupMaxQueries,
      timeoutMs: input.env.llmTimeoutMs,
      maxRetries: input.env.llmMaxRetries
    },
    undefined,
    {
      logger: input.logger.child({
        component: 'llm'
      }),
      logLlmText: input.env.logLlmText
    }
  );
}

export function createOptionalProviders(env: AppEnv): OptionalProviders {
  return {
    lookupProvider:
      env.lookupProvider === 'tavily' && env.tavilyApiKey
        ? new TavilyLookupProvider({ apiKey: env.tavilyApiKey })
        : null,
    speechToTextProvider:
      env.sttProvider === 'gladia' && env.gladiaApiKey
        ? new GladiaTranscriptionProvider({ apiKey: env.gladiaApiKey })
        : null,
    textToSpeechProvider: env.yandexSpeechKitApiKey
      ? new YandexSpeechKitTtsProvider({
          apiKey: env.yandexSpeechKitApiKey
        })
      : null,
    ocrProvider: env.ocrSpaceApiKey
      ? new OcrSpaceProvider({ apiKey: env.ocrSpaceApiKey })
      : null,
    visionProvider:
      env.visionProvider === 'cloudflare' &&
      env.cloudflareAiApiKey &&
      env.cloudflareAccountId
        ? new CloudflareVisionProvider({
            accountId: env.cloudflareAccountId,
            apiKey: env.cloudflareAiApiKey
          })
        : null
  };
}
