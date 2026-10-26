import type {
  ReplyContext,
  ReplyGenerationIntent
} from '../../src/domain/models.js';
import type { DescribeMediaContext } from '../../src/llm/prompts.js';
import type { LookupSource } from '../../src/lookup/types.js';

export type IntentEvalRubric = {
  mustIncludeAny: string[][];
  mustIncludeAll?: string[];
  mustMatchRegex?: string[];
  mustNotIncludeAny: string[][];
  mustNotMatchRegex?: string[];
};

export type IntentEvalFixture = {
  id: string;
  intent: ReplyGenerationIntent;
  targetDisplayName: string;
  assistantInstructions: string;
  currentDateTime: string;
  replyContext: ReplyContext;
  expectedMode?: 'direct' | 'clarify' | 'research';
  expectedMessageIds?: number[];
  mediaContext?: DescribeMediaContext;
  evaluation?: {
    category: string;
    origin: string;
    criteria: string;
    maxResponseChars?: number;
    requiredBotMessageIds: number[];
  };
  lookupExpectation?: {
    shouldLookup: boolean;
    purpose:
      | 'none'
      | 'entity_grounding'
      | 'fact_check'
      | 'freshness'
      | 'link_extraction';
    includeTerms: string[];
    includeAnyTerms?: string[];
    sources?: LookupSource[];
  };
  rubric: IntentEvalRubric;
};
