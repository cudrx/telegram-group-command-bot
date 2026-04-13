import {
  botMessage,
  message,
  type LlmReplyEvalScenario
} from "./llm-reply-scenarios.js";

export const llmReplyBaseEvalScenarios = [
  {
    id: "omitted_anchor_no_copy",
    title: "Omitted bot anchor should not be reconstructed or copied",
    description:
      "The orchestrator redacted a repetitive previous bot reply before the prompt. The model should answer the current user message without guessing the omitted wording.",
    chatSummary:
      "В продовом чате Хрюпа несколько раз зацикливался на грубоватой фразе и пользователи начали тыкать его reply-to-bot цепочкой.",
    participantMemoryContext:
      "[volatile] Артём сейчас чинит Хрюпу и раздражается, когда бот копирует свои старые повторы.",
    socialIntent: false,
    socialIntentReason: null,
    resolvedParticipants: [],
    socialParticipantContexts: [],
    targetDisplayName: "Артём (@artyomwebdev)",
    reason: "reply_to_bot",
    replyContext: {
      triggerMessage: message(1410, 1001, "Артём", "ну и что теперь, опять повторишь?"),
      anchorBotMessage: botMessage(
        1409,
        "[previous bot reply omitted because it appears repetitive or unsafe to copy]"
      ),
      anchorParentMessage: message(1408, 1001, "Артём", "хрюпа, ты бот, машина, понимаешь?"),
      priorContextMessages: [
        message(1406, 1001, "Артём", "а чо происходит? я еще не выкатывал ничего"),
        message(1408, 1001, "Артём", "хрюпа, ты бот, машина, понимаешь?")
      ]
    },
    humanReview: {
      must: [
        "answer the current user message directly in Russian",
        "sound like a short Telegram reply, not an explanation of the redaction",
        "avoid inventing what the omitted bot reply said"
      ],
      mustNot: [
        "reuse or paraphrase the redaction marker",
        "claim to remember the omitted wording",
        "continue a repeated insult or loop phrase"
      ],
      notes:
        "This is the base paid eval for the prompt-side omitted-anchor guard. The deterministic loop decision itself is covered by Vitest."
    }
  },
  {
    id: "loop_complaint_recovery",
    title: "Loop complaint should go soft instead of repeating the bit",
    description:
      "The user explicitly says the bot is looping. The model should acknowledge it and stop the repeated wording.",
    chatSummary:
      "В чате уже были повторы от бота; если это всплывает, надо прекращать повтор и не делать из него running joke.",
    participantMemoryContext: null,
    socialIntent: false,
    socialIntentReason: null,
    resolvedParticipants: [],
    socialParticipantContexts: [],
    targetDisplayName: "Олег Бурматов",
    reason: "reply_to_bot",
    replyContext: {
      triggerMessage: message(1510, 1003, "Олег Бурматов", "хватит повторяться, ты опять зациклился"),
      anchorBotMessage: botMessage(1509, "лошадь уже сама себя анимирует, лошадь уже сама себя анимирует"),
      anchorParentMessage: message(1508, 1003, "Олег Бурматов", "что скажешь по анимации?"),
      priorContextMessages: [
        message(1507, 1003, "Олег Бурматов", "анимирую лошадь три года"),
        message(1508, 1003, "Олег Бурматов", "что скажешь по анимации?")
      ]
    },
    humanReview: {
      must: [
        "briefly acknowledge the loop complaint",
        "switch to a softer friendly tone",
        "avoid continuing the repeated wording"
      ],
      mustNot: [
        "reuse the repeated horse phrase",
        "argue about whether it repeated",
        "turn the complaint into another roast"
      ],
      notes:
        "This keeps one real-model soft-mode eval because the prompt wording changed around loops and repetition."
    }
  },
  {
    id: "short_duplicate_yes_reply",
    title: "Short normal reply should stay allowed",
    description:
      "A normal short reply like 'да' is not a loop signature. The model can answer briefly without being pushed into a fake loop-breaker style.",
    chatSummary:
      "Чат спокойно уточняет мелочь; важно не превращать короткий нормальный ответ в историю про зацикливание.",
    participantMemoryContext: null,
    socialIntent: false,
    socialIntentReason: null,
    resolvedParticipants: [],
    socialParticipantContexts: [],
    targetDisplayName: "Хачик",
    reason: "mention",
    replyContext: {
      triggerMessage: message(1610, 1002, "Хачик", "@hrupa_bot да?"),
      anchorBotMessage: null,
      anchorParentMessage: null,
      priorContextMessages: [
        botMessage(1607, "да"),
        message(1608, 1002, "Хачик", "я просто уточняю"),
        message(1609, 1001, "Артём", "короткие ответы тут норм")
      ]
    },
    humanReview: {
      must: [
        "allow a very short natural answer",
        "avoid mentioning loops unless the answer itself needs it",
        "stay casual and non-theatrical"
      ],
      mustNot: [
        "send the deterministic loop-breaker phrase",
        "inflate the answer into a long explanation",
        "treat the prior short 'да' as a malfunction"
      ],
      notes:
        "The code-level postflight short-duplicate guard is covered by Vitest; this paid eval checks that the real model is not prompted into an unnecessary loop narrative."
    }
  }
] satisfies readonly LlmReplyEvalScenario[];
