import type { RubricResult } from './types.js';

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
