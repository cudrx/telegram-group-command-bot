import type { EvalResult } from './types.js';

export function printResult(result: EvalResult): void {
  console.log('');
  console.log(`=== ${result.id} (${result.intent}) ===`);
  console.log(result.response);
  console.log('');
  console.log('Rubric:');

  for (const check of result.rubric.include) {
    console.log(
      `${check.passed ? 'PASS' : 'FAIL'} include any: ${check.group.join(' | ')}`
    );
  }

  for (const check of result.rubric.includeAll) {
    console.log(`${check.passed ? 'PASS' : 'FAIL'} include all: ${check.term}`);
  }

  for (const check of result.rubric.matchRegex) {
    console.log(
      `${check.passed ? 'PASS' : 'FAIL'} match regex: ${check.pattern}`
    );
  }

  for (const check of result.rubric.exclude) {
    console.log(
      `${check.passed ? 'PASS' : 'FAIL'} exclude all: ${check.group.join(' | ')}`
    );
  }

  for (const check of result.rubric.notMatchRegex) {
    console.log(
      `${check.passed ? 'PASS' : 'FAIL'} not match regex: ${check.pattern}`
    );
  }
}

export function formatMarkdown(results: EvalResult[]): string {
  return [
    '# Assistant Intent Eval Results',
    '',
    `Generated at: ${new Date().toISOString()}`,
    '',
    ...results.flatMap((result) => [
      `## ${result.id} (${result.intent})`,
      '',
      '### Prompt',
      '',
      '```text',
      result.prompt,
      '```',
      '',
      '### Response',
      '',
      result.response,
      '',
      '### Rubric',
      '',
      ...result.rubric.include.map(
        (check) =>
          `- ${check.passed ? 'PASS' : 'FAIL'} include any: ${check.group.join(' | ')}`
      ),
      ...result.rubric.includeAll.map(
        (check) =>
          `- ${check.passed ? 'PASS' : 'FAIL'} include all: ${check.term}`
      ),
      ...result.rubric.matchRegex.map(
        (check) =>
          `- ${check.passed ? 'PASS' : 'FAIL'} match regex: ${check.pattern}`
      ),
      ...result.rubric.exclude.map(
        (check) =>
          `- ${check.passed ? 'PASS' : 'FAIL'} exclude all: ${check.group.join(' | ')}`
      ),
      ...result.rubric.notMatchRegex.map(
        (check) =>
          `- ${check.passed ? 'PASS' : 'FAIL'} not match regex: ${check.pattern}`
      ),
      ''
    ])
  ].join('\n');
}
