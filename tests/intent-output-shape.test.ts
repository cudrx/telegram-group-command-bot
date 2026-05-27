import { describe, expect, test } from 'vitest';

import { getIntentOutputShapeViolations } from '../src/llm/intent-output-shape.js';

describe('getIntentOutputShapeViolations', () => {
  test('requires summarize heading and separated final takeaway', () => {
    expect(
      getIntentOutputShapeViolations(
        'summarize',
        [
          '<b>Short Summary</b>',
          '• one',
          '• two',
          '',
          '<b>Takeaway</b> — conclusion'
        ].join('\n')
      )
    ).toEqual([]);

    expect(
      getIntentOutputShapeViolations(
        'summarize',
        ['<b>Short Summary</b>', '• one', '<b>Takeaway</b> — conclusion'].join(
          '\n'
        )
      )
    ).toContain('missing_summarize_shape');
  });

  test('requires decide HTML sections and catches markdown leaks', () => {
    expect(
      getIntentOutputShapeViolations(
        'decide',
        [
          '<b>Positions</b>',
          '• A',
          '',
          '<b>Evidence</b>',
          '• fact',
          '',
          '<b>Verdict</b>',
          'conclusion'
        ].join('\n')
      )
    ).toEqual([]);

    expect(
      getIntentOutputShapeViolations('decide', 'Summary:\n**oops**')
    ).toEqual(
      expect.arrayContaining([
        'english_summary_heading',
        'markdown_bold',
        'missing_decide_shape'
      ])
    );
  });

  test('does not require fixed shape for read and answer', () => {
    expect(
      getIntentOutputShapeViolations('read', 'Просто распознанный текст.')
    ).toEqual([]);

    expect(
      getIntentOutputShapeViolations('answer', 'Короткий прямой ответ.')
    ).toEqual([]);
  });
});
