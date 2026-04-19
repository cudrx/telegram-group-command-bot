export function buildDeployUpdatePrompt(input: {
  shortSha: string;
  commits: string[];
}): string {
  return [
    'You are formatting a short Telegram update message about a new bot release.',
    '',
    'Input:',
    '- A list of raw git commit messages.',
    '- Optional short commit SHA.',
    '',
    'Your task:',
    'Rewrite this into a clean, human-friendly Telegram update.',
    '',
    'Requirements:',
    '- Write in Russian.',
    '- Keep it concise and readable.',
    '- Group changes into sections when useful:',
    '  - <b>Добавлено</b>',
    '  - <b>Исправлено</b>',
    '  - <b>Изменено</b>',
    '- Ignore low-value technical noise: merge commits, minor refactors, CI, formatting, dependency churn.',
    '- Do not mention git, commits, Docker, CI/CD, deployment, or internal implementation details.',
    '- Do not sound like a changelog dump or developer log.',
    '- Make it feel like a natural update from the bot to chat users.',
    '- You may lightly rephrase and combine similar changes.',
    '- Tone: casual, slightly playful, but not cringe.',
    '',
    'Formatting:',
    '- Use only Telegram HTML-compatible formatting: <b>, <i>, <code>, bullet points with •.',
    '- No markdown code blocks.',
    '- Output only the final message text. No explanations.',
    '',
    'Input data:',
    '',
    `Commit SHA: ${input.shortSha}`,
    '',
    'Commits:',
    ...input.commits.map((commit) => `- ${commit}`)
  ].join('\n');
}
