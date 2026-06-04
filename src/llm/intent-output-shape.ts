import type { ReplyGenerationIntent } from '../domain/models.js';
import { text } from '../locales/locale.js';

export type IntentOutputShapeViolation =
  | 'english_summary_heading'
  | 'markdown_bold'
  | 'missing_summarize_shape'
  | 'missing_decide_shape';

export function getIntentOutputShapeViolations(
  intent: ReplyGenerationIntent,
  reply: string
): IntentOutputShapeViolation[] {
  const violations: IntentOutputShapeViolation[] = [];

  if (/^\s*summary\s*:/im.test(reply)) {
    violations.push('english_summary_heading');
  }

  if (/\*\*[^*\n][\s\S]*?\*\*/.test(reply)) {
    violations.push('markdown_bold');
  }

  if (intent === 'summarize' && !hasSummarizeShape(reply)) {
    violations.push('missing_summarize_shape');
  }

  if (
    intent === 'decide' &&
    !hasOrderedSections(reply, [
      text.llm.sections.decide.positions,
      text.llm.sections.decide.evidence,
      text.llm.sections.decide.verdict
    ])
  ) {
    violations.push('missing_decide_shape');
  }

  return violations;
}

function hasSummarizeShape(reply: string): boolean {
  const shortSummary = escapeRegExp(text.llm.sections.summarize.shortSummary);
  const takeaway = escapeRegExp(text.llm.sections.summarize.takeaway);
  const pattern = new RegExp(
    `^<b>${shortSummary}</b>[\\s\\S]+\\n\\n<b>${takeaway}</b>\\s+—`,
    'u'
  );

  return pattern.test(reply.trim());
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
