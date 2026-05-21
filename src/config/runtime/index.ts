import { answerActionConfig } from './actions/answer.js';
import { decideActionConfig } from './actions/decide.js';
import { memeActionConfig } from './actions/meme.js';
import { readActionConfig } from './actions/read.js';
import { summarizeActionConfig } from './actions/summarize.js';
import { localizationConfig } from './localization.js';
import { llmProviderConfig } from './providers/llm.js';
import { lookupProviderConfig } from './providers/lookup.js';
import { mediaProviderConfig } from './providers/media.js';
import { ttsProviderConfig } from './providers/tts.js';
import { storageConfig } from './storage.js';

export const runtimeConfig = {
  actions: {
    answer: answerActionConfig,
    decide: decideActionConfig,
    meme: memeActionConfig,
    read: readActionConfig,
    summarize: summarizeActionConfig
  },
  providers: {
    llm: llmProviderConfig,
    lookup: lookupProviderConfig,
    media: mediaProviderConfig,
    tts: ttsProviderConfig
  },
  localization: localizationConfig,
  storage: storageConfig
} as const;

export { answerActionConfig } from './actions/answer.js';
export { decideActionConfig } from './actions/decide.js';
export { memeActionConfig } from './actions/meme.js';
export { readActionConfig } from './actions/read.js';
export { summarizeActionConfig } from './actions/summarize.js';
export { localizationConfig } from './localization.js';
export { llmProviderConfig } from './providers/llm.js';
export { lookupProviderConfig } from './providers/lookup.js';
export { mediaProviderConfig } from './providers/media.js';
export { ttsProviderConfig } from './providers/tts.js';
export { storageConfig } from './storage.js';
