import type { AssistantIntent } from '../domain/models.js';

export type IntentOutputShapeViolation =
  | 'english_summary_heading'
  | 'markdown_bold'
  | 'missing_explain_shape'
  | 'missing_summarize_shape'
  | 'missing_decide_shape';

export function getIntentOutputShapeViolations(
  intent: AssistantIntent,
  reply: string
): IntentOutputShapeViolation[] {
  const violations: IntentOutputShapeViolation[] = [];

  if (/^\s*summary\s*:/im.test(reply)) {
    violations.push('english_summary_heading');
  }

  if (/\*\*[^*\n][\s\S]*?\*\*/.test(reply)) {
    violations.push('markdown_bold');
  }

  if (
    intent === 'explain' &&
    !hasOrderedSections(reply, ['Смысл', 'По сути', 'Вывод'])
  ) {
    violations.push('missing_explain_shape');
  }

  if (
    intent === 'summarize' &&
    !/^<b>Коротко<\/b>[\s\S]+\n\n<b>Итог<\/b>\s+—/u.test(reply.trim())
  ) {
    violations.push('missing_summarize_shape');
  }

  if (
    intent === 'decide' &&
    !hasOrderedSections(reply, ['Позиции', 'Что видно', 'Вердикт'])
  ) {
    violations.push('missing_decide_shape');
  }

  return violations;
}

function hasOrderedSections(reply: string, sections: string[]): boolean {
  let cursor = 0;

  for (const section of sections) {
    const marker = `<b>${section}</b>`;
    const index = reply.indexOf(marker, cursor);

    if (index === -1) {
      return false;
    }

    cursor = index + marker.length;
  }

  return true;
}
