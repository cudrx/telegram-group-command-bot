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
        '- Итог: чат работает как полигон для отладки.'
      ].join('\n'),
      { intent: 'summarize' }
    );

    expect(formatted).toBe(
      [
        '• Участники тестируют команды (<code>/summarize</code>, <code>/answer</code>).',
        '• <b>Краткий ориентир:</b> бот проверяют на спорных репликах.',
        '<b>Итог</b> — чат работает как полигон для отладки.'
      ].join('\n')
    );
  });

  test('keeps intent-specific formatting isolated between reply types', () => {
    expect(formatTelegramHtmlReply('Следить дальше: 1) нефть; 2) курс.')).toBe(
      'Следить дальше: 1) нефть; 2) курс.'
    );

    expect(
      formatTelegramHtmlReply('Summary:\nИтог: всё работает', {
        intent: 'summarize'
      })
    ).toBe('<b>Итог</b> — всё работает');

    expect(
      formatTelegramHtmlReply('Следить дальше: 1) нефть; 2) курс.', {
        intent: 'news'
      })
    ).toBe('<b>Следить дальше:</b>\n\n1. нефть\n2. курс.');
  });

  test('normalizes markdown headings as bold titles for news replies', () => {
    const formatted = formatTelegramHtmlReply(
      ['# Отчёт по новостям', '## 1. Общая картина', 'Текст'].join('\n'),
      { intent: 'news' }
    );

    expect(formatted).toBe(
      [
        '<b>Отчёт по новостям</b>',
        '',
        '<b>1. Общая картина</b>',
        '',
        'Текст'
      ].join('\n')
    );
  });

  test('does not normalize markdown headings for generic replies', () => {
    const formatted = formatTelegramHtmlReply('## 1. Общая картина');

    expect(formatted).toBe('## 1. Общая картина');
  });

  test('escapes html-like text inside news markdown headings', () => {
    const formatted = formatTelegramHtmlReply('# 2 < 3 & важно', {
      intent: 'news'
    });

    expect(formatted).toBe('<b>2 &lt; 3 &amp; важно</b>');
  });

  test('adds readable spacing before news sections and signal labels', () => {
    const formatted = formatTelegramHtmlReply(
      [
        '1. Общая картина',
        'Текст общего блока.',
        '2. Главные сигналы',
        'Сигнал 1: Китай и санкции',
        'Значение: важный контекст.',
        'Уверенность: средняя.'
      ].join('\n'),
      { intent: 'news' }
    );

    expect(formatted).toBe(
      [
        '<b>1. Общая картина</b>',
        '',
        'Текст общего блока.',
        '',
        '<b>2. Главные сигналы</b>',
        '',
        '<b>Сигнал 1: Китай и санкции</b>',
        '',
        '<b>Значение:</b> важный контекст.',
        '',
        '<b>Уверенность:</b> средняя.'
      ].join('\n')
    );
  });

  test('normalizes markdown-wrapped news labels and final lines', () => {
    const formatted = formatTelegramHtmlReply(
      [
        '*Значение:* важный контекст.',
        '*Уверенность:* средняя.',
        '5. Итог',
        'Итог: общий вывод.',
        'Для РФ: нейтрально.',
        'Для гражданина РФ: главный риск.',
        'Война: истощение.',
        'Следить дальше: нефть, курс, санкции.'
      ].join('\n'),
      { intent: 'news' }
    );

    expect(formatted).toBe(
      [
        '<b>Значение:</b> важный контекст.',
        '',
        '<b>Уверенность:</b> средняя.',
        '',
        '<b>5. Итог</b>',
        '',
        '<b>Итог:</b> общий вывод.',
        '',
        '<b>Для РФ:</b> нейтрально.',
        '',
        '<b>Для гражданина РФ:</b> главный риск.',
        '',
        '<b>Война:</b> истощение.',
        '',
        '<b>Следить дальше:</b> нефть, курс, санкции.'
      ].join('\n')
    );
  });

  test('expands inline numbered follow-up items for news replies', () => {
    const formatted = formatTelegramHtmlReply(
      'Следить дальше: 1) нефть США; 2) акции Rheinmetall; 3) реакция Китая; 4) курс рубля.',
      { intent: 'news' }
    );

    expect(formatted).toBe(
      [
        '<b>Следить дальше:</b>',
        '',
        '1. нефть США',
        '2. акции Rheinmetall',
        '3. реакция Китая',
        '4. курс рубля.'
      ].join('\n')
    );
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
