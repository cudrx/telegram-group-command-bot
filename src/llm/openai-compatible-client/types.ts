import type OpenAI from 'openai';

import type {
  ReplyContext,
  ReplyGenerationIntent
} from '../../domain/models.js';
import type { AppLogger } from '../../logging/logger.js';
import type {
  LookupContext,
  LookupDecision,
  LookupIntent
} from '../../lookup/types.js';
import type { DescribeMediaContext } from '../prompts.js';

export type LlmReplyResult = {
  text: string;
  model: string;
  source: 'llm' | 'local';
  latencyMs: number;
  attemptCount: number;
  promptTokensEstimate: number;
};

export type LookupPlanResult = {
  status: 'ok' | 'failed';
  decision: LookupDecision;
  model: string;
  latencyMs: number;
  attemptCount: number;
  promptTokensEstimate: number;
};

export type LlmClientConfig = {
  apiKey: string;
  baseUrl: string;
  replyModel: string;
  replyTemperature: number;
  plannerModel?: string;
  lookupMaxQueries?: number;
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
  intent: ReplyGenerationIntent;
  currentDateTime: string;
  replyContext: ReplyContext;
  lookupContext?: LookupContext | null;
  mediaContext?: DescribeMediaContext | null;
};

export type GenerateWeeklyInput = {
  assistantInstructions: string;
  weeklyDataset: string;
};

export type GenerateMemeCaptionInput = {
  title: string;
  subreddit: string;
  upvotes: number;
  permalink: string;
  mediaKind: 'image' | 'animation';
};

export type PlanLookupInput = {
  intent: LookupIntent;
  replyContext: ReplyContext;
};
