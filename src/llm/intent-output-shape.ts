export type IntentOutputShapeViolation =
  | 'english_summary_heading'
  | 'markdown_bold';

export function getIntentOutputShapeViolations(
  reply: string
): IntentOutputShapeViolation[] {
  const violations: IntentOutputShapeViolation[] = [];

  if (/^\s*summary\s*:/im.test(reply)) {
    violations.push('english_summary_heading');
  }

  if (/\*\*[^*\n][\s\S]*?\*\*/.test(reply)) {
    violations.push('markdown_bold');
  }

  return violations;
}
