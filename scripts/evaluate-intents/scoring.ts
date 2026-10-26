import {
  type ExperimentMessage,
  readTranscriptRow
} from '../evaluate-conversation/context.js';
import type { IntentEvalFixture } from '../intent-eval-fixtures/types.js';
import type { EvalResult, RubricResult } from './types.js';

export function evaluateFixtureChecks(
  fixture: IntentEvalFixture,
  response: string,
  fittedMessages: ExperimentMessage[]
): EvalResult['evaluation'] {
  const rules = fixture.evaluation;
  if (!rules) return undefined;

  const botIds = new Set(
    fittedMessages
      .filter((message) => message.role === 'user')
      .flatMap((message) => message.content.split('\n'))
      .flatMap((line) => {
        const row = readTranscriptRow(line);
        return row?.isBot ? [row.id] : [];
      })
  );
  const missingIds = rules.requiredBotMessageIds.filter(
    (id) => !botIds.has(id)
  );

  return {
    category: rules.category,
    length: {
      actual: response.length,
      max: rules.maxResponseChars ?? null,
      passed:
        rules.maxResponseChars === undefined ||
        response.length <= rules.maxResponseChars
    },
    botContext: {
      requiredIds: rules.requiredBotMessageIds,
      missingIds,
      passed: missingIds.length === 0
    },
    semantic: { criteria: rules.criteria, status: 'pending' }
  };
}

export function getEvalStatus(
  result: EvalResult
): 'passed' | 'failed' | 'needs_review' {
  const evaluation = result.evaluation;
  if (
    hasRubricFailures(result.rubric) ||
    result.conversation?.passed === false ||
    evaluation?.length.passed === false ||
    evaluation?.botContext.passed === false ||
    evaluation?.semantic.status === 'failed'
  )
    return 'failed';
  if (evaluation?.semantic.status === 'pending') return 'needs_review';

  return 'passed';
}

export function evaluateRubric(
  response: string,
  rubric: {
    mustIncludeAny: string[][];
    mustIncludeAll?: string[];
    mustMatchRegex?: string[];
    mustNotIncludeAny: string[][];
    mustNotMatchRegex?: string[];
  }
): RubricResult {
  const normalized = response.toLowerCase();

  return {
    include: rubric.mustIncludeAny.map((group) => ({
      group,
      passed: group.some((term) => normalized.includes(term.toLowerCase()))
    })),
    includeAll: (rubric.mustIncludeAll ?? []).map((term) => ({
      term,
      passed: normalized.includes(term.toLowerCase())
    })),
    matchRegex: (rubric.mustMatchRegex ?? []).map((pattern) => ({
      pattern,
      passed: new RegExp(pattern, 'iu').test(response)
    })),
    exclude: rubric.mustNotIncludeAny.map((group) => ({
      group,
      passed: group.every((term) => !normalized.includes(term.toLowerCase()))
    })),
    notMatchRegex: (rubric.mustNotMatchRegex ?? []).map((pattern) => ({
      pattern,
      passed: !new RegExp(pattern, 'iu').test(response)
    }))
  };
}

export function hasRubricFailures(rubric: RubricResult): boolean {
  return (
    rubric.include.some((check) => !check.passed) ||
    rubric.includeAll.some((check) => !check.passed) ||
    rubric.matchRegex.some((check) => !check.passed) ||
    rubric.exclude.some((check) => !check.passed) ||
    rubric.notMatchRegex.some((check) => !check.passed)
  );
}
