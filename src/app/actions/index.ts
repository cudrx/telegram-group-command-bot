import type { ChatCommand, ChatFeature } from '../../config/env/types.js';
import { memeAction } from './meme/index.js';
import { readAction } from './read/index.js';
import { createActionRegistry } from './registry.js';
import { sexAction } from './sex/index.js';
import { transcribeAction } from './transcribe/index.js';
import { translateAction } from './translate/index.js';
import type { ChatAction, FeatureGatedAccessContext } from './types.js';

export const chatActions = [
  translateAction,
  readAction,
  transcribeAction,
  memeAction,
  sexAction
] satisfies ChatAction[];

export const chatActionRegistry = createActionRegistry(chatActions);

export function isCommandEnabledForAccessContext(
  accessContext: FeatureGatedAccessContext,
  command: ChatCommand
): boolean {
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
