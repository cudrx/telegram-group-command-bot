import type { ChatCommand, ChatFeature } from '../../config/env/types.js';
import { answerAction } from './answer/index.js';
import { decideAction } from './decide/index.js';
import { memeAction } from './meme/index.js';
import { readAction } from './read/index.js';
import {
  chatActionRequiredFeatures,
  createActionRegistry
} from './registry.js';
import { sexAction } from './sex/index.js';
import { summarizeAction } from './summarize/index.js';
import { transcribeAction } from './transcribe/index.js';
import { translateAction } from './translate/index.js';
import type { ChatAction, FeatureGatedAccessContext } from './types.js';

export const chatActions = [
  summarizeAction,
  decideAction,
  answerAction,
  translateAction,
  readAction,
  transcribeAction,
  memeAction,
  sexAction
] satisfies ChatAction[];

export const chatActionRegistry = createActionRegistry(chatActions);

export { chatActionRequiredFeatures };

export function isCommandEnabledForAccessContext(
  accessContext: FeatureGatedAccessContext,
  command: ChatCommand | null
): boolean {
  if (!command) return true;

  if (accessContext.kind !== 'configured_chat') return true;

  return accessContext.policy.commands[command];
}

export function isFeatureEnabledForAccessContext(
  accessContext: FeatureGatedAccessContext,
  feature: ChatFeature | null
): boolean {
  if (!feature) return true;
  if (accessContext.kind !== 'configured_chat') return true;

  return accessContext.policy.features[feature];
}
