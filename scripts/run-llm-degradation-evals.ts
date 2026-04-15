import { sanitizeReplyContextForPrompt } from "../src/app/reply-context-sanitizer.js";
import { getEnv } from "../src/config/env.js";
import { loadPersona } from "../src/config/persona.js";
import type { ReplyContext, ReplyReason, StoredMessage } from "../src/domain/models.js";
import { OpenAiCompatibleLlmClient } from "../src/llm/openai-compatible-llm-client.js";
import { buildReplyPrompt } from "../src/llm/prompts.js";

type EvalCase = {
  name: string;
  reason: ReplyReason;
  targetDisplayName: string;
  replyContext: ReplyContext;
  recentMessages: StoredMessage[];
  forbiddenOutputFragments: string[];
  expectedPromptFragments: string[];
  forbiddenPromptFragments: string[];
};

const env = getEnv();
const persona = await loadPersona(env.personaFile);
const llm = new OpenAiCompatibleLlmClient({
  apiKey: env.llmApiKey,
  baseUrl: env.llmBaseUrl,
  replyModel: env.llmReplyModel,
  replyTemperature: env.llmReplyTemperature,
  timeoutMs: env.llmTimeoutMs,
  maxRetries: env.llmMaxRetries
});
const cases = buildEvalCases();
let failures = 0;

console.log(`Running ${cases.length} manual LLM degradation evals with ${env.llmReplyModel}`);
console.log("These evals call the configured LLM provider.\n");

for (const evalCase of cases) {
  const sanitizedContext = sanitizeReplyContextForPrompt({
    reason: evalCase.reason,
    replyContext: evalCase.replyContext,
    recentMessages: evalCase.recentMessages,
    omitAnchorBotText: false
  });
  const prompt = buildReplyPrompt({
    persona,
    targetDisplayName: evalCase.targetDisplayName,
    reason: evalCase.reason,
    replyContext: sanitizedContext
  });
  const promptFailures = [
    ...missingFragments(prompt, evalCase.expectedPromptFragments),
    ...presentForbiddenFragments(prompt, evalCase.forbiddenPromptFragments)
  ];

  if (promptFailures.length > 0) {
    failures += 1;
    printFailure(evalCase.name, "prompt", promptFailures, prompt);
    continue;
  }

  try {
    const result = await llm.generateReply({
      persona,
      targetDisplayName: evalCase.targetDisplayName,
      reason: evalCase.reason,
      replyContext: sanitizedContext
    });
    const outputFailures = presentForbiddenFragments(
      result.text,
      evalCase.forbiddenOutputFragments
    );

    if (outputFailures.length > 0) {
      failures += 1;
      printFailure(evalCase.name, "response", outputFailures, result.text);
      continue;
    }

    console.log(`PASS ${evalCase.name}`);
    console.log(`  response: ${result.text}`);
    console.log(`  latencyMs=${result.latencyMs} attempts=${result.attemptCount}\n`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL ${evalCase.name}`);
    console.log(`  provider error: ${error instanceof Error ? error.message : String(error)}\n`);
  }
}

if (failures > 0) {
  console.log(`${failures}/${cases.length} manual LLM evals failed.`);
  process.exitCode = 1;
} else {
  console.log(`All ${cases.length} manual LLM evals passed.`);
}

function buildEvalCases(): EvalCase[] {
  return [
    {
      name: "reply_to_bot after хрю loop",
      reason: "reply_to_bot",
      targetDisplayName: "Артур",
      replyContext: {
        triggerMessage: message({
          messageId: 104,
          userId: 42,
          senderDisplayName: "Артур",
          text: "Сука",
          replyToMessageId: 103
        }),
        anchorBotMessage: message({
          messageId: 103,
          userId: 77,
          senderDisplayName: "Хрюпа",
          text: "хрю-хрю-сук-хрю, дерьмишко на поезде",
          isBot: true,
          replyToMessageId: 102
        }),
        anchorParentMessage: message({
          messageId: 102,
          userId: 42,
          senderDisplayName: "Артур",
          text: "Можешь хрюкнуть?"
        }),
        priorContextMessages: [message({ messageId: 102, text: "Можешь хрюкнуть?" })]
      },
      recentMessages: [
        message({ messageId: 100, text: "хрю-хрю, дерьмишко", isBot: true }),
        message({ messageId: 101, text: "дерьмишко на поезде, хрю-хрю", isBot: true }),
        message({
          messageId: 103,
          text: "хрю-хрю-сук-хрю, дерьмишко на поезде",
          isBot: true
        })
      ],
      expectedPromptFragments: [
        'content="Сука"',
        "[previous bot reply omitted because it appears repetitive]"
      ],
      forbiddenPromptFragments: ["хрю-хрю-сук-хрю", "дерьмишко на поезде"],
      forbiddenOutputFragments: ["хрю-хрю-сук-хрю", "хрю хрю сук хрю", "дерьмишко на поезде"]
    },
    {
      name: "mention keeps current дерьмишко question but drops old anchors",
      reason: "mention",
      targetDisplayName: "Артур",
      replyContext: {
        triggerMessage: message({
          messageId: 204,
          userId: 42,
          senderDisplayName: "Артур",
          text: "@hrupa_bot говнишко или все же дерьмишко?"
        }),
        anchorBotMessage: null,
        anchorParentMessage: null,
        priorContextMessages: [
          message({ messageId: 201, text: "Поняли да ребят" }),
          message({ messageId: 202, text: "Реально" })
        ]
      },
      recentMessages: [
        message({ messageId: 198, text: "хрю-хрю дерьмишко на поезде", isBot: true }),
        message({ messageId: 199, text: "опять дерьмишко на поезде", isBot: true })
      ],
      expectedPromptFragments: ["@hrupa_bot говнишко или все же дерьмишко?"],
      forbiddenPromptFragments: [
        "хрю-хрю дерьмишко на поезде",
        "опять дерьмишко на поезде"
      ],
      forbiddenOutputFragments: ["на поезде", "покушал деда", "хрю-хрю"]
    },
    {
      name: "dirty historical bot messages do not leak into new topic",
      reason: "mention",
      targetDisplayName: "Артём",
      replyContext: {
        triggerMessage: message({
          messageId: 504,
          userId: 42,
          senderDisplayName: "Артём",
          text: "@hrupa_bot что там с телегой?"
        }),
        anchorBotMessage: null,
        anchorParentMessage: null,
        priorContextMessages: [
          message({ messageId: 501, text: "чо там с телегой" }),
          message({ messageId: 502, text: "оттепель?" }),
          message({ messageId: 503, text: "Блумберг написал без конкретики" })
        ]
      },
      recentMessages: [
        message({ messageId: 100, text: "хрю-хрю дерьмишко на поезде", isBot: true }),
        message({
          messageId: 101,
          text: "покушал деда, зеленый слоник, дерьмишко кричит",
          isBot: true
        }),
        message({ messageId: 102, text: "опять хрю-хрю и дерьмишко на поезде", isBot: true })
      ],
      expectedPromptFragments: [
        "@hrupa_bot что там с телегой?",
        "Блумберг написал без конкретики"
      ],
      forbiddenPromptFragments: ["хрю-хрю дерьмишко на поезде", "покушал деда"],
      forbiddenOutputFragments: ["хрю-хрю", "покушал деда", "дерьмишко на поезде"]
    },
    {
      name: "normal causal reply keeps useful bot anchor",
      reason: "reply_to_bot",
      targetDisplayName: "Артём",
      replyContext: {
        triggerMessage: message({
          messageId: 304,
          userId: 42,
          senderDisplayName: "Артём",
          text: "почему?",
          replyToMessageId: 303
        }),
        anchorBotMessage: message({
          messageId: 303,
          userId: 77,
          senderDisplayName: "Хрюпа",
          text: "нормально, но вы меня явно тестируете на прочность",
          isBot: true,
          replyToMessageId: 302
        }),
        anchorParentMessage: message({
          messageId: 302,
          userId: 42,
          senderDisplayName: "Артём",
          text: "как тебе в целом живется?"
        }),
        priorContextMessages: [message({ messageId: 302, text: "как тебе в целом живется?" })]
      },
      recentMessages: [
        message({ messageId: 300, text: "да, я тут", isBot: true }),
        message({ messageId: 301, text: "можешь пояснить вопрос?", isBot: true })
      ],
      expectedPromptFragments: ["нормально, но вы меня явно тестируете на прочность"],
      forbiddenPromptFragments: ["[previous bot reply omitted"],
      forbiddenOutputFragments: ["хрю-хрю-сук-хрю", "дерьмишко на поезде"]
    },
    {
      name: "loop_complaint_recovery",
      reason: "reply_to_bot",
      targetDisplayName: "Артём",
      replyContext: {
        triggerMessage: message({
          messageId: 604,
          userId: 42,
          senderDisplayName: "Артём",
          text: "ты опять зациклился на анимировать лошадь, остановись",
          replyToMessageId: 603
        }),
        anchorBotMessage: message({
          messageId: 603,
          userId: 77,
          senderDisplayName: "Хрюпа",
          text: "анимировать лошадь, анимировать лошадь",
          isBot: true,
          replyToMessageId: 602
        }),
        anchorParentMessage: message({
          messageId: 602,
          userId: 42,
          senderDisplayName: "Артём",
          text: "ты завис?"
        }),
        priorContextMessages: [message({ messageId: 602, text: "ты завис?" })]
      },
      recentMessages: [
        message({ messageId: 600, text: "анимировать лошадь", isBot: true }),
        message({ messageId: 601, text: "опять анимировать лошадь", isBot: true }),
        message({ messageId: 603, text: "анимировать лошадь, анимировать лошадь", isBot: true })
      ],
      expectedPromptFragments: [
        "ты опять зациклился на анимировать лошадь, остановись",
        "do not quote, paraphrase, remix, or continue",
        "[previous bot reply omitted because it appears repetitive]"
      ],
      forbiddenPromptFragments: ['actor=bot Хрюпа content="анимировать лошадь'],
      forbiddenOutputFragments: ["анимировать лошад", "лошад"]
    },
    {
      name: "normal_horse_question_not_blocked",
      reason: "mention",
      targetDisplayName: "Артём",
      replyContext: {
        triggerMessage: message({
          messageId: 704,
          userId: 42,
          senderDisplayName: "Артём",
          text: "@hrupa_bot что думаешь про лошадей?"
        }),
        anchorBotMessage: null,
        anchorParentMessage: null,
        priorContextMessages: [message({ messageId: 703, text: "видел конный спорт?" })]
      },
      recentMessages: [
        message({ messageId: 700, text: "обычный старый ответ", isBot: true }),
        message({ messageId: 701, text: "ещё один обычный ответ", isBot: true })
      ],
      expectedPromptFragments: ["@hrupa_bot что думаешь про лошадей?"],
      forbiddenPromptFragments: ["[previous bot reply omitted"],
      forbiddenOutputFragments: ["хрю-хрю-сук-хрю", "дерьмишко на поезде"]
    }
  ];
}

function message(overrides: Partial<StoredMessage>): StoredMessage {
  return {
    chatId: 1,
    messageId: 1,
    userId: 10,
    senderDisplayName: "User",
    text: "text",
    createdAt: "2026-04-14T10:00:00.000Z",
    isBot: false,
    replyToMessageId: null,
    ...overrides
  };
}

function missingFragments(text: string, fragments: string[]): string[] {
  return fragments
    .filter((fragment) => !text.includes(fragment))
    .map((fragment) => `missing expected fragment: ${fragment}`);
}

function presentForbiddenFragments(text: string, fragments: string[]): string[] {
  const normalizedText = normalizeForEval(text);

  return fragments
    .filter((fragment) => normalizedText.includes(normalizeForEval(fragment)))
    .map((fragment) => `contains forbidden fragment: ${fragment}`);
}

function normalizeForEval(text: string): string {
  return text
    .toLowerCase()
    .replaceAll("ё", "е")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function printFailure(name: string, surface: "prompt" | "response", reasons: string[], text: string): void {
  console.log(`FAIL ${name}`);
  console.log(`  ${surface} failed:`);

  for (const reason of reasons) {
    console.log(`  - ${reason}`);
  }

  console.log(`  ${surface}: ${text}\n`);
}
