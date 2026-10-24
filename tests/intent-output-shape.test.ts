import { describe, expect, test } from 'vitest';

import { getIntentOutputShapeViolations } from '../src/llm/intent-output-shape.js';

describe('getIntentOutputShapeViolations', () => {
  test('does not impose mode headers', () => {
    expect(
      getIntentOutputShapeViolations('Короткий ответ без заголовков.')
    ).toEqual([]);
  });
  test('still detects raw Markdown formatting', () => {
    expect(getIntentOutputShapeViolations('Summary:\n**oops**')).toEqual([
      'english_summary_heading',
      'markdown_bold'
    ]);
  });
});
