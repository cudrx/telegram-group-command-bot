import { describe, expect, test } from 'vitest';

import { formatTelegramHtmlReply } from '../src/app/telegram-html/index.js';

describe('formatTelegramHtmlReply', () => {
  test('preserves safe Telegram HTML tags and escapes raw text', () => {
    const formatted = formatTelegramHtmlReply(
      '<b>Итог</b>\n\n2 < 3, но 5 > 4 & это ок'
    );

    expect(formatted).toBe('<b>Итог</b>\n\n2 &lt; 3, но 5 &gt; 4 &amp; это ок');
  });

  test('removes unsupported tags while preserving their text content', () => {
    const formatted = formatTelegramHtmlReply(
      '<a href="https://example.com">ссылка</a> <u>подчеркнуто</u> <script>alert</script>'
    );

    expect(formatted).toBe('ссылка подчеркнуто alert');
  });

  test('normalizes markdown-like bullets and excessive blank lines', () => {
    const formatted = formatTelegramHtmlReply(
      'Коротко:\n\n\n- первый пункт\n* второй пункт\n  • третий пункт\n\n\n\nконец'
    );

    expect(formatted).toBe(
      'Коротко:\n\n• первый пункт\n• второй пункт\n• третий пункт\n\nконец'
    );
  });

  test('normalizes common model markdown for summarize replies', () => {
    const formatted = formatTelegramHtmlReply(
      [
        'Summary:',
        '- Участники тестируют команды (`/summarize`, `/answer`).',
        '- **Краткий ориентир:** бот проверяют на спорных репликах.',
        '- Takeaway: чат работает как полигон для отладки.'
      ].join('\n'),
      { intent: 'summarize' }
    );

    expect(formatted).toBe(
      [
        '• Участники тестируют команды (<code>/summarize</code>, <code>/answer</code>).',
        '• <b>Краткий ориентир:</b> бот проверяют на спорных репликах.',
        '<b>Takeaway</b> — чат работает как полигон для отладки.'
      ].join('\n')
    );
  });

  test('keeps intent-specific formatting isolated between reply types', () => {
    expect(formatTelegramHtmlReply('Следить дальше: 1) нефть; 2) курс.')).toBe(
      'Следить дальше: 1) нефть; 2) курс.'
    );

    expect(
      formatTelegramHtmlReply('Summary:\nTakeaway: всё работает', {
        intent: 'summarize'
      })
    ).toBe('<b>Takeaway</b> — всё работает');
  });

  test('does not normalize markdown headings for generic replies', () => {
    const formatted = formatTelegramHtmlReply('## 1. Общая картина');

    expect(formatted).toBe('## 1. Общая картина');
  });

  test('escapes html-like text inside markdown code spans', () => {
    const formatted = formatTelegramHtmlReply('`<b>не тег</b>`');

    expect(formatted).toBe('<code>&lt;b&gt;не тег&lt;/b&gt;</code>');
  });

  test('normalizes allowed tag attributes and repairs unclosed tags', () => {
    const formatted = formatTelegramHtmlReply(
      '<b class="title">Смысл\n\n<i data-x="1">важно'
    );

    expect(formatted).toBe('<b>Смысл\n\n<i>важно</i></b>');
  });

  test('closes nested tags before a mismatched parent closing tag', () => {
    const formatted = formatTelegramHtmlReply(
      '<b>жирно <i>курсив</b> хвост</i>'
    );

    expect(formatted).toBe('<b>жирно <i>курсив</i></b> хвост');
  });

  test('drops malformed closing tags with trailing junk', () => {
    const formatted = formatTelegramHtmlReply('<b>bold</b nope> tail');

    expect(formatted).toBe('<b>bold tail</b>');
  });
});
