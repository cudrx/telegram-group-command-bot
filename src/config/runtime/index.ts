import { answerActionConfig } from './actions/answer.js';
import { readActionConfig } from './actions/read.js';
import { memeActionConfig, sexActionConfig } from './actions/reddit-media.js';
import { localizationConfig } from './localization.js';
import { llmProviderConfig } from './providers/llm.js';
import { lookupProviderConfig } from './providers/lookup.js';
import { mediaProviderConfig } from './providers/media.js';
import { ttsProviderConfig } from './providers/tts.js';
import { storageConfig } from './storage.js';

export const runtimeConfig = {
  actions: {
    answer: answerActionConfig,
    meme: memeActionConfig,
    read: readActionConfig,
    sex: sexActionConfig
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
export { readActionConfig } from './actions/read.js';
export {
  memeActionConfig,
  redditMediaActionConfig,
  sexActionConfig
} from './actions/reddit-media.js';
export { localizationConfig } from './localization.js';
export { llmProviderConfig } from './providers/llm.js';
export { lookupProviderConfig } from './providers/lookup.js';
export { mediaProviderConfig } from './providers/media.js';
export { ttsProviderConfig } from './providers/tts.js';
export { storageConfig } from './storage.js';
