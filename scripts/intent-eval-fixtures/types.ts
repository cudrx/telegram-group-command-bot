import type { AssistantIntent, ReplyContext } from '../../src/domain/models.js';
import type { DescribeMediaContext } from '../../src/llm/prompts.js';

export type IntentEvalRubric = {
  mustIncludeAny: string[][];
  mustIncludeAll?: string[];
  mustMatchRegex?: string[];
  mustNotIncludeAny: string[][];
  mustNotMatchRegex?: string[];
};

export type IntentEvalFixture = {
  id: string;
  intent: AssistantIntent;
  targetDisplayName: string;
  assistantInstructions: string;
  currentDateTime: string;
  replyContext: ReplyContext;
  mediaContext?: DescribeMediaContext;
  lookupExpectation?: {
    shouldLookup: boolean;
    purpose:
      | 'none'
      | 'entity_grounding'
      | 'fact_check'
      | 'freshness'
      | 'link_extraction';
    includeTerms: string[];
  };
  rubric: IntentEvalRubric;
};
