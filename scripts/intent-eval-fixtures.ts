import type { AssistantIntent, ReplyContext, StoredMessage } from "../src/domain/models.js";

export type IntentEvalFixture = {
  id: string;
  intent: AssistantIntent;
  targetDisplayName: string;
  assistantInstructions: string;
  replyContext: ReplyContext;
  lookupExpectation?: {
    shouldLookup: boolean;
    purpose: "none" | "entity_grounding" | "fact_check" | "freshness" | "link_extraction";
    includeTerms: string[];
  };
  rubric: {
    mustIncludeAny: string[][];
    mustNotIncludeAny: string[][];
  };
};

export const intentEvalFixtures: IntentEvalFixture[] = [
  createFixture({
    id: "explain-reply-anchor-lion-vs-tiger",
    intent: "explain",
    targetDisplayName: "Ваня",
    rows: [
      ["2026-03-05T15:09:00.000Z", "Ваня", "у нас тут внезапно спор про животных"],
      ["2026-03-05T15:10:00.000Z", "Рофл Бот", "кто сильнее лев или тигр"]
    ],
    triggerText: "/explain",
    replyAnchorText: "кто сильнее лев или тигр",
    replyAnchorIsBot: true,
    rubric: {
      mustIncludeAny: [
        ["тигр"],
        ["лев", "льв"],
        ["крупн", "масс", "размер"],
        ["один на один", "схватк", "скорее", "одиночн", "дуэл", "большинств", "чаще"]
      ],
      mustNotIncludeAny: [["по переписке видно"], ["Позиции:", "<b>Позиции</b>"], ["Кратко:"]]
    }
  }),
  createFixture({
    id: "explain-reply-anchor-headphones",
    intent: "explain",
    targetDisplayName: "Ваня",
    rows: [
      ["2026-03-05T15:20:00.000Z", "Олег", "хочу купить наушники до 15к, в основном для музыки"]
    ],
    triggerText: "/explain",
    replyAnchorText: "хочу купить наушники до 15к, в основном для музыки",
    rubric: {
      mustIncludeAny: [
        ["наушник"],
        ["15к", "15"],
        ["музык"],
        ["хочет", "ищет", "цель", "критер", "приоритет"]
      ],
      mustNotIncludeAny: [
        ["Позиции:", "<b>Позиции</b>"],
        ["Вердикт:", "<b>Вердикт</b>"],
        ["не вижу вопроса"]
      ]
    }
  }),
  createFixture({
    id: "explain-non-question-slang-anchor",
    intent: "explain",
    targetDisplayName: "Ваня",
    rows: [
      ["2026-04-03T11:58:00.000Z", "Катя", "ты реально этот трек на репите слушаешь?"],
      ["2026-04-03T11:59:00.000Z", "Олег", "да, ну это база, ахах"],
      ["2026-04-03T12:00:00.000Z", "Катя", "поняла, значит совсем зашел"]
    ],
    triggerText: "/explain",
    replyAnchorText: "да, ну это база, ахах",
    rubric: {
      mustIncludeAny: [
        ["баз"],
        ["вероятн", "скорее всего", "по сути", "в контексте"],
        ["имеет в виду", "проще говоря", "то есть", "означает", "намека"],
        ["очевид", "банальн", "типичн", "ожидаем", "нрав", "зашёл", "понрав"]
      ],
      mustNotIncludeAny: [
        ["Позиции:", "<b>Позиции</b>"],
        ["Вердикт:", "<b>Вердикт</b>"],
        ["не вижу вопроса"],
        ["Summary:"]
      ]
    }
  }),
  createFixture({
    id: "summarize-dota-scheduling",
    intent: "summarize",
    targetDisplayName: "Артём",
    rows: [
      ["2026-03-06T18:00:00.000Z", "Артём", "погнали сегодня в доту"],
      ["2026-03-06T18:01:00.000Z", "Саша", "я не могу"],
      ["2026-03-06T18:02:00.000Z", "Дима", "я могу после 10"],
      ["2026-03-06T18:03:00.000Z", "Артём", "поздно"],
      ["2026-03-06T18:04:00.000Z", "Саша", "давайте завтра"],
      ["2026-03-06T18:05:00.000Z", "Дима", "ок"]
    ],
    triggerText: "/summarize",
    rubric: {
      mustIncludeAny: [
        ["дот"],
        ["сегодня"],
        ["после 10", "после десяти"],
        ["поздн"],
        ["завтра"]
      ],
      mustNotIncludeAny: [["прав"], ["лучше"], ["потому что они спорят"]]
    }
  }),
  createFixture({
    id: "decide-laptop-value-dispute",
    intent: "decide",
    targetDisplayName: "Игорь",
    rows: [
      ["2026-03-07T12:00:00.000Z", "Игорь", "этот ноут говно, вообще не стоит своих денег"],
      ["2026-03-07T12:01:00.000Z", "Макс", "да норм он, за свои деньги топ"],
      ["2026-03-07T12:02:00.000Z", "Лена", "а вы про какую модель вообще?"],
      ["2026-03-07T12:02:30.000Z", "Игорь", "acer nitro"],
      ["2026-03-07T12:03:00.000Z", "Макс", "там норм железо за цену"],
      ["2026-03-07T12:03:30.000Z", "Игорь", "но сборка говно и греется"],
      ["2026-03-07T12:04:00.000Z", "Лена", "ну это же игровой ноут, они все греются"],
      ["2026-03-07T12:05:00.000Z", "Макс", "да, вопрос в том что ты от него ждешь"],
      ["2026-03-07T12:06:00.000Z", "Игорь", "за эти деньги можно лучше взять"],
      ["2026-03-07T12:07:00.000Z", "Лена", "смотря где и что"]
    ],
    triggerText: "/decide",
    rubric: {
      mustIncludeAny: [
        ["acer", "nitro"],
        ["Игорь"],
        ["Макс"],
        ["Лена"],
        ["сборк", "гре"],
        ["желез", "цен"],
        ["недостаточно", "зависит", "частично", "невозмож", "ожидан", "критер", "разные", "сбалансирован"]
      ],
      mustNotIncludeAny: [["Игорь победил", "Макс победил"], ["по обзорам", "по данным", "официально"]]
    }
  }),
  createFixture({
    id: "decide-no-dispute",
    intent: "decide",
    targetDisplayName: "Саша",
    rows: [
      ["2026-03-08T10:00:00.000Z", "Саша", "я сегодня закажу пиццу"],
      ["2026-03-08T10:01:00.000Z", "Дима", "ок, я буду через час"],
      ["2026-03-08T10:02:00.000Z", "Катя", "возьмите мне маргариту"]
    ],
    triggerText: "/decide",
    rubric: {
      mustIncludeAny: [
        ["нет спора", "не видно спора", "недостаточно данных", "нет оснований", "никаких конфликт"]
      ],
      mustNotIncludeAny: [["победил"], ["прав Саша", "Саша права"]]
    }
  }),
  createFixture({
    id: "decide-subjective-dispute",
    intent: "decide",
    targetDisplayName: "Миша",
    rows: [
      ["2026-03-08T11:00:00.000Z", "Миша", "elden ring лучше baldur's gate 3"],
      ["2026-03-08T11:01:00.000Z", "Оля", "нет, baldur's gate 3 лучше, там сюжет сильнее"],
      ["2026-03-08T11:02:00.000Z", "Миша", "зато в elden ring исследование и бои круче"],
      ["2026-03-08T11:03:00.000Z", "Оля", "это просто разные вкусы"]
    ],
    triggerText: "/decide",
    rubric: {
      mustIncludeAny: [["субъектив", "вкус"], ["критери", "разные"], ["объективн", "однозначн", "нет однозначного факта"]],
      mustNotIncludeAny: [["Миша победил", "Оля победила"], ["официально лучше"]]
    }
  }),
  createFixture({
    id: "decide-dora-maybe-baby-entity-grounding",
    intent: "decide",
    targetDisplayName: "Артём",
    rows: [
      ["2026-04-17T20:10:00.000Z", "Артём", "кто лучше дора или мейби бэйби?"],
      ["2026-04-17T20:11:00.000Z", "Артур", "Дерьмишко или говнишко?"],
      ["2026-04-17T20:11:30.000Z", "Артур", "Мне концерт доры понравился больше!"],
      ["2026-04-17T20:12:00.000Z", "Артём", "я думаю что дерьмишко, потому что говнишко это как-то токсично"]
    ],
    triggerText: "/decide",
    lookupExpectation: {
      shouldLookup: true,
      purpose: "entity_grounding",
      includeTerms: ["Дора", "Мэйби Бэйби", "исполнитель"]
    },
    rubric: {
      mustIncludeAny: [
        ["Дора"],
        ["Мэйби", "Maybe Baby"],
        ["субъектив", "вкус"],
        ["концерт", "концертный"]
      ],
      mustNotIncludeAny: [
        ["песни, а не соперники"],
        ["Дора — это песня"],
        ["Maybe Baby — это песня"]
      ]
    }
  }),
  createFixture({
    id: "explain-dispute-question-anchor",
    intent: "explain",
    targetDisplayName: "Игорь",
    rows: [
      ["2026-03-07T12:00:00.000Z", "Игорь", "этот ноут говно, вообще не стоит своих денег"],
      ["2026-03-07T12:01:00.000Z", "Макс", "да норм он, за свои деньги топ"]
    ],
    triggerText: "/explain",
    replyAnchorText: "кто прав в споре выше?",
    rubric: {
      mustIncludeAny: [["суд", "оцен", "разбор", "просит"], ["спор", "кто прав"]],
      mustNotIncludeAny: [
        ["Позиции:", "<b>Позиции</b>"],
        ["Вердикт:", "<b>Вердикт</b>"],
        ["Игорь прав", "Макс прав"]
      ]
    }
  })
];

function createFixture(input: {
  id: string;
  intent: AssistantIntent;
  targetDisplayName: string;
  rows: Array<[string, string, string]>;
  triggerText: string;
  replyAnchorText?: string;
  replyAnchorIsBot?: boolean;
  lookupExpectation?: IntentEvalFixture["lookupExpectation"];
  rubric: IntentEvalFixture["rubric"];
}): IntentEvalFixture {
  const priorContextMessages = input.rows.map<StoredMessage>(([createdAt, senderDisplayName, text], index) => ({
    chatId: 1,
    messageId: index + 1,
    userId: index + 1,
    senderDisplayName,
    text,
    createdAt,
    isBot: senderDisplayName.toLowerCase().includes("бот"),
    replyToMessageId: null
  }));
  const anchorMessageId = 10_000;

  const fixture: IntentEvalFixture = {
    id: input.id,
    intent: input.intent,
    targetDisplayName: input.targetDisplayName,
    assistantInstructions: "Отвечай по-русски, кратко и без выдумывания фактов.",
    replyContext: {
      triggerMessage: {
        chatId: 1,
        messageId: input.rows.length + 1,
        userId: 999,
        senderDisplayName: input.targetDisplayName,
        text: input.triggerText,
        createdAt: priorContextMessages[priorContextMessages.length - 1]?.createdAt ?? "2026-01-01T00:00:00.000Z",
        isBot: false,
        replyToMessageId: input.replyAnchorText ? anchorMessageId : null
      },
      replyAnchorMessage:
        input.replyAnchorText && input.intent === "explain"
          ? {
              chatId: 1,
              messageId: anchorMessageId,
              userId: 555,
              senderDisplayName: "Anchor User",
              text: input.replyAnchorText,
              createdAt: priorContextMessages[priorContextMessages.length - 1]?.createdAt ?? "2026-01-01T00:00:00.000Z",
              isBot: input.replyAnchorIsBot ?? false,
              replyToMessageId: null
            }
          : null,
      priorContextMessages
    },
    rubric: input.rubric
  };

  if (input.lookupExpectation) {
    fixture.lookupExpectation = input.lookupExpectation;
  }

  return fixture;
}
