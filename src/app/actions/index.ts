import { answerAction } from './answer/index.js';
import { decideAction } from './decide/index.js';
import { memeAction } from './meme/index.js';
import { publishAction } from './publish/index.js';
import { readAction } from './read/index.js';
import { createActionRegistry } from './registry.js';
import { summarizeAction } from './summarize/index.js';
import { translateAction } from './translate/index.js';
import type { ChatAction } from './types.js';

export const chatActions = [
  summarizeAction,
  decideAction,
  answerAction,
  translateAction,
  readAction,
  memeAction,
  publishAction
] satisfies ChatAction[];

export const chatActionRegistry = createActionRegistry(chatActions);
