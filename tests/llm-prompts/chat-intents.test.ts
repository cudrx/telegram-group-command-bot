import { describe, expect, test } from 'vitest';

import { buildIntentPrompt } from '../../src/llm/prompts.js';

describe('buildIntentPrompt chat intent response shapes', () => {
  test('builds summarize prompt as chat-only compression without command arguments', () => {
    const prompt = buildIntentPrompt({
      assistantInstructions: 'отвечай кратко',
      targetDisplayName: 'Tom',
      intent: 'summarize',
      replyContext: {
        triggerMessage: {
          chatId: 1,
          messageId: 3,
          userId: 1,
          senderDisplayName: 'Tom',
          text: '/summarize ignored text',
          createdAt: '2026-04-03T12:00:00.000Z',
          isBot: false,
          replyToMessageId: null
        },
        replyAnchorMessage: null,
        priorContextMessages: []
      }
    });

    expect(prompt).toContain('The selected task mode is: summarize');
    expect(prompt).toContain('You are in SUMMARIZE mode.');
    expect(prompt).toContain('Do not use external knowledge.');
    expect(prompt).toContain('Do not decide who is right.');
    expect(prompt).toContain('CHAT_CONTEXT_DATA:');
    expect(prompt).toContain('<b>Коротко</b>');
    expect(prompt).toContain('3 to 5 short bullet points using •');
    expect(prompt).toContain(
      'Add exactly one final line after bullets: <b>Итог</b> — concise takeaway.'
    );
    expect(prompt).toContain(
      'Insert one empty line between the final bullet and the final <b>Итог</b> line.'
    );
    expect(prompt).toContain(
      'The final line must not repeat bullets or introduce new unrelated info.'
    );
    expect(prompt).toContain('No text before <b>Коротко</b>.');
    expect(prompt).toContain('No text after the final <b>Итог</b> line.');
    expect(prompt).toContain(
      'Do not add meta commentary about the summarization task.'
    );
    expect(prompt).toContain(
      "Do not write 'Summary:' or English summary headings."
    );
    expect(prompt).toContain('Do not use Markdown markers like **bold**.');
    expect(prompt).toContain(
      "Do not write phrases like 'Суммаризация завершена' or 'Данных для точного анализа недостаточно'."
    );
    expect(prompt).toContain('No command arguments are used for this mode.');
    expect(prompt).toContain('Required response shape:');
    expect(prompt).not.toContain('optional meaningful <b>Итог</b>');
    expect(prompt).not.toContain(
      "Do not add a separate 'Итог:' bullet or section."
    );
    expect(prompt).not.toContain(
      'Do not add a final verdict, winner, or analysis-status line.'
    );
    expect(prompt).not.toContain(
      'do not start every answer with the same heading'
    );
    expect(prompt).not.toContain('Preferred response shape:');
    expect(prompt).not.toContain('ignored text');
  });

  test('builds decide prompt for chat disputes without external knowledge', () => {
    const prompt = buildIntentPrompt({
      assistantInstructions: 'отвечай кратко',
      targetDisplayName: 'Tom',
      intent: 'decide',
      replyContext: {
        triggerMessage: {
          chatId: 1,
          messageId: 3,
          userId: 1,
          senderDisplayName: 'Tom',
          text: '/decide кто прав',
          createdAt: '2026-04-03T12:00:00.000Z',
          isBot: false,
          replyToMessageId: null
        },
        replyAnchorMessage: null,
        priorContextMessages: []
      }
    });

    expect(prompt).toContain('The selected task mode is: decide');
    expect(prompt).toContain('You are in DECIDE mode.');
    expect(prompt).toContain('A dispute may involve 2 or more participants.');
    expect(prompt).toContain(
      'Use external facts only when EXTERNAL_LOOKUP_CONTEXT is present.'
    );
    expect(prompt).toContain(
      'If lookup context is present, separate what the chat supports from what external sources support.'
    );
    expect(prompt).toContain('Do not invent outside facts.');
    expect(prompt).toContain(
      'If the transcript is not enough for a reliable verdict, say so.'
    );
    expect(prompt).toContain(
      'Preserve central named entities, product names, artist names, and model names.'
    );
    expect(prompt).toContain(
      'If named entities are compared, name each compared entity clearly in <b>Позиции</b> and keep the relation explicit, for example "prefers A over B".'
    );
    expect(prompt).toContain(
      'Do not replace compared entities with generic words like "alternative", "other option", or "second side".'
    );
    expect(prompt).toContain(
      'Do not broaden evidence about one compared entity to all compared entities.'
    );
    expect(prompt).toContain(
      'Do not summarize the whole chat outside the dispute.'
    );
    expect(prompt).toContain(
      'Do not explain messages individually; compare positions and support.'
    );
    expect(prompt).toContain(
      'If the dispute is unresolved, say which position is better supported so far, or that the evidence is insufficient.'
    );
    expect(prompt).toContain('CHAT_CONTEXT_DATA:');
    expect(prompt).toContain('Required response shape:');
    expect(prompt).toContain('<b>Позиции</b>');
    expect(prompt).toContain('<b>Что видно</b>');
    expect(prompt).toContain('<b>Вердикт</b>');
    expect(prompt.indexOf('<b>Позиции</b>')).toBeLessThan(
      prompt.indexOf('<b>Что видно</b>')
    );
    expect(prompt.indexOf('<b>Что видно</b>')).toBeLessThan(
      prompt.indexOf('<b>Вердикт</b>')
    );
    expect(prompt).toContain('<short decision, 1-2 lines maximum>');
    expect(prompt).toContain('Do not add extra sections or final lines.');
    expect(prompt).toContain('Always use these 3 sections.');
    expect(prompt).toContain('Keep each section short.');
    expect(prompt).toContain('Keep the verdict to 1-2 lines maximum.');
    expect(prompt).toContain(
      '• <b><participant or side>:</b> <their core claim>'
    );
    expect(prompt).toContain('Keep verdict concise and concrete.');
    expect(prompt).toContain('No command arguments are used for this mode.');
    expect(prompt).not.toContain('Optional final line:');
    expect(prompt).not.toContain('кто прав');
  });
});
