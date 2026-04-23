export function renderPromptTemplate(
  template: string,
  values: Record<string, string>
): string {
  return Object.entries(values)
    .reduce(
      (rendered, [key, value]) =>
        rendered.replaceAll(`{{${key}}}`, () => value),
      template
    )
    .trim();
}
