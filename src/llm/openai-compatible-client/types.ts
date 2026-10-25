import type OpenAI from 'openai';

import type {
  ReplyContext,
  ReplyGenerationIntent
} from '../../domain/models.js';
import type { AppLogger } from '../../logging/logger.js';
import type { DescribeMediaContext } from '../prompts.js';

export type LlmReplyResult = {
  text: string;
  model: string;
  source: 'llm' | 'local';
  latencyMs: number;
  attemptCount: number;
  promptTokensEstimate: number;
};

export type LlmClientConfig = {
  apiKey: string;
  baseUrl: string;
  replyModel: string;
  replyTemperature: number;
  timeoutMs: number;
  maxRetries: number;
};

export type LlmClientOptions = {
  logger?: AppLogger;
  logLlmText?: boolean;
};

export type ChatCompletionsCreate = OpenAI['chat']['completions']['create'];

export type GenerateReplyInput = {
  assistantInstructions: string;
  targetDisplayName: string;
  intent: Exclude<ReplyGenerationIntent, 'answer'>;
  currentDateTime: string;
  replyContext: ReplyContext;
  mediaContext?: DescribeMediaContext | null;
};
