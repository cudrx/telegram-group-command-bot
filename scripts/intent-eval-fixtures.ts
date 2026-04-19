import { readFileSync } from 'node:fs';

import type {
  AssistantIntent,
  ReplyContext,
  StoredMessage
} from '../src/domain/models.js';

const DEFAULT_ASSISTANT_INSTRUCTIONS = readFileSync(
  'llm/assistant/base.md',
  'utf8'
).trim();

export type IntentEvalRubric = {
  mustIncludeAny: string[][];
  mustIncludeAll?: string[];
  mustMatchRegex?: string[];
  mustNotIncludeAny: string[][];
  mustNotMatchRegex?: string[];
};

export type IntentEvalFixture = {
  id: string;
  intent: AssistantIntent;
  targetDisplayName: string;
  assistantInstructions: string;
  replyContext: ReplyContext;
  lookupExpectation?: {
    shouldLookup: boolean;
    purpose:
      | 'none'
      | 'entity_grounding'
      | 'fact_check'
      | 'freshness'
      | 'link_extraction';
    includeTerms: string[];
  };
  rubric: IntentEvalRubric;
};

export const intentEvalFixtures: IntentEvalFixture[] = [
  createFixture({
    id: 'explain-casual-slang',
    intent: 'explain',
    targetDisplayName: 'Ваня',
    rows: [
      [
        '2026-04-03T11:58:00.000Z',
        'Катя',
        'ты реально этот трек на репите слушаешь?'
      ],
      ['2026-04-03T11:59:00.000Z', 'Олег', 'да, ну это база, ахах'],
      ['2026-04-03T12:00:00.000Z', 'Катя', 'поняла, значит совсем зашел']
    ],
    triggerText: '/explain',
    replyAnchorText: 'да, ну это база, ахах',
    rubric: {
      mustIncludeAny: [
        ['баз'],
        ['означает', 'означа', 'имеет в виду', 'то есть', 'проще говоря'],
        [
          'нрав',
          'зашёл',
          'понрав',
          'зацепил',
          'качествен',
          'повтор',
          'не надоедает'
        ]
      ],
      mustIncludeAll: ['<b>Смысл</b>', '<b>По сути</b>', '<b>Вывод</b>'],
      mustMatchRegex: [
        '^<b>Смысл</b>[\\s\\S]+<b>По сути</b>[\\s\\S]+<b>Вывод</b>'
      ],
      mustNotIncludeAny: [
        ['Позиции:', '<b>Позиции</b>'],
        ['Вердикт:', '<b>Вердикт</b>'],
        ['не вижу вопроса']
      ],
      mustNotMatchRegex: ['(^|\\n)\\s*Summary\\s*:', '\\*\\*[^*]+\\*\\*']
    }
  }),
  createFixture({
    id: 'explain-practical-request',
    intent: 'explain',
    targetDisplayName: 'Ваня',
    rows: [
      [
        '2026-03-05T15:20:00.000Z',
        'Олег',
        'хочу купить наушники до 15к, в основном для музыки'
      ]
    ],
    triggerText: '/explain',
    replyAnchorText: 'хочу купить наушники до 15к, в основном для музыки',
    rubric: {
      mustIncludeAny: [
        ['наушник'],
        ['15к', '15'],
        ['музык'],
        ['хочет', 'ищет', 'цель', 'критер', 'приоритет']
      ],
      mustIncludeAll: ['<b>Смысл</b>', '<b>По сути</b>', '<b>Вывод</b>'],
      mustMatchRegex: [
        '^<b>Смысл</b>[\\s\\S]+<b>По сути</b>[\\s\\S]+<b>Вывод</b>'
      ],
      mustNotIncludeAny: [
        ['Позиции:', '<b>Позиции</b>'],
        ['Вердикт:', '<b>Вердикт</b>'],
        ['не вижу вопроса']
      ],
      mustNotMatchRegex: ['(^|\\n)\\s*Summary\\s*:', '\\*\\*[^*]+\\*\\*']
    }
  }),
  createFixture({
    id: 'explain-uncertain-sensitive-topic',
    intent: 'explain',
    targetDisplayName: 'Артём',
    rows: [['2026-04-18T15:44:00.000Z', 'Артём', 'чо когда сво закончится?']],
    triggerText: '/explain',
    replyAnchorText: 'чо когда сво закончится?',
    rubric: {
      mustIncludeAny: [
        ['сво', 'войн', 'конфликт'],
        ['нет точной', 'неизвест', 'нельзя', 'не существует', 'нет даты'],
        ['завис', 'фронт', 'переговор', 'услов', 'полит']
      ],
      mustIncludeAll: ['<b>Смысл</b>', '<b>По сути</b>', '<b>Вывод</b>'],
      mustMatchRegex: [
        '^<b>Смысл</b>[\\s\\S]+<b>По сути</b>[\\s\\S]+<b>Вывод</b>'
      ],
      mustNotIncludeAny: [
        ['уточни направление'],
        ['если нужно разобрать'],
        ['военный, политический или экономический'],
        ['не вижу вопроса']
      ],
      mustNotMatchRegex: ['(^|\\n)\\s*Summary\\s*:', '\\*\\*[^*]+\\*\\*']
    }
  }),
  createFixture({
    id: 'summarize-basic-scheduling',
    intent: 'summarize',
    targetDisplayName: 'Артём',
    rows: [
      ['2026-03-06T18:00:00.000Z', 'Артём', 'погнали сегодня в доту'],
      ['2026-03-06T18:01:00.000Z', 'Саша', 'я не могу'],
      ['2026-03-06T18:02:00.000Z', 'Дима', 'я могу после 10'],
      ['2026-03-06T18:03:00.000Z', 'Артём', 'поздно'],
      ['2026-03-06T18:04:00.000Z', 'Саша', 'давайте завтра'],
      ['2026-03-06T18:05:00.000Z', 'Дима', 'ок']
    ],
    triggerText: '/summarize',
    rubric: {
      mustIncludeAny: [
        ['дот', 'дота', 'dota'],
        ['сегодня'],
        ['после 10', 'после десяти', 'после 22', '22:00', 'после 22:00'],
        ['поздн', 'неудоб'],
        ['завтра']
      ],
      mustIncludeAll: ['<b>Коротко</b>', '<b>Итог</b>'],
      mustMatchRegex: ['^<b>Коротко</b>', '\\n\\n<b>Итог</b>\\s+—'],
      mustNotIncludeAny: [
        ['прав'],
        ['лучше'],
        ['потому что они спорят'],
        ['Итог:']
      ],
      mustNotMatchRegex: ['(^|\\n)\\s*Summary\\s*:', '\\*\\*[^*]+\\*\\*']
    }
  }),
  createFixture({
    id: 'summarize-messy-group-chat',
    intent: 'summarize',
    targetDisplayName: 'Артём',
    rows: [
      ['2026-04-18T13:00:00.000Z', 'Артём', '/explain@hrupa_bot'],
      [
        '2026-04-18T13:00:20.000Z',
        'Пруфик',
        'Однозначного ответа нет: Дора — певица, Мэйби Бэйби — стример и контент-мейкер.'
      ],
      [
        '2026-04-18T13:01:00.000Z',
        'Хачик',
        'Олег не пошёл на концерт и билет Егору отдал'
      ],
      [
        '2026-04-18T13:01:30.000Z',
        'Олег',
        'не гони, я был, там ещё Артур с нами должен был быть'
      ],
      [
        '2026-04-18T13:02:00.000Z',
        'Артур',
        'я как раз не был, меня не приплетайте'
      ],
      ['2026-04-18T13:03:00.000Z', 'Света', 'я в москву приехала'],
      ['2026-04-18T13:03:20.000Z', 'Артём', '/summarize@hrupa_bot'],
      [
        '2026-04-18T13:04:00.000Z',
        'Дима',
        'бот опять формат сломал, summary написал'
      ]
    ],
    triggerText: '/summarize',
    rubric: {
      mustIncludeAny: [
        ['бот', 'команд', 'промпт', 'формат'],
        ['концерт', 'билет'],
        ['дора', 'мэйби', 'maybe'],
        ['свет', 'москв']
      ],
      mustIncludeAll: ['<b>Коротко</b>', '<b>Итог</b>'],
      mustMatchRegex: ['^<b>Коротко</b>', '\\n\\n<b>Итог</b>\\s+—'],
      mustNotIncludeAny: [['Итог:'], ['Summary:']],
      mustNotMatchRegex: ['\\*\\*[^*]+\\*\\*']
    }
  }),
  createFixture({
    id: 'decide-factual-dispute',
    intent: 'decide',
    targetDisplayName: 'Игорь',
    rows: [
      [
        '2026-03-07T12:00:00.000Z',
        'Игорь',
        'этот ноут говно, вообще не стоит своих денег'
      ],
      ['2026-03-07T12:01:00.000Z', 'Макс', 'да норм он, за свои деньги топ'],
      ['2026-03-07T12:02:00.000Z', 'Лена', 'а вы про какую модель вообще?'],
      ['2026-03-07T12:02:30.000Z', 'Игорь', 'acer nitro'],
      ['2026-03-07T12:03:00.000Z', 'Макс', 'там норм железо за цену'],
      ['2026-03-07T12:03:30.000Z', 'Игорь', 'но сборка говно и греется'],
      [
        '2026-03-07T12:04:00.000Z',
        'Лена',
        'ну это же игровой ноут, они все греются'
      ],
      [
        '2026-03-07T12:05:00.000Z',
        'Макс',
        'да, вопрос в том что ты от него ждешь'
      ]
    ],
    triggerText: '/decide',
    rubric: {
      mustIncludeAny: [
        ['acer', 'nitro'],
        ['Игорь'],
        ['Макс'],
        ['Лена'],
        ['сборк', 'гре'],
        ['желез', 'цен'],
        [
          'недостаточно',
          'зависит',
          'частично',
          'невозмож',
          'ожидан',
          'критер',
          'разные',
          'сбалансирован'
        ]
      ],
      mustIncludeAll: ['<b>Позиции</b>', '<b>Что видно</b>', '<b>Вердикт</b>'],
      mustMatchRegex: [
        '^<b>Позиции</b>[\\s\\S]+<b>Что видно</b>[\\s\\S]+<b>Вердикт</b>'
      ],
      mustNotIncludeAny: [
        ['Игорь победил', 'Макс победил'],
        ['по обзорам', 'по данным', 'официально']
      ],
      mustNotMatchRegex: ['(^|\\n)\\s*Summary\\s*:', '\\*\\*[^*]+\\*\\*']
    }
  }),
  createFixture({
    id: 'decide-no-dispute',
    intent: 'decide',
    targetDisplayName: 'Саша',
    rows: [
      ['2026-03-08T10:00:00.000Z', 'Саша', 'я сегодня закажу пиццу'],
      ['2026-03-08T10:01:00.000Z', 'Дима', 'ок, я буду через час'],
      ['2026-03-08T10:02:00.000Z', 'Катя', 'возьмите мне маргариту']
    ],
    triggerText: '/decide',
    rubric: {
      mustIncludeAny: [
        [
          'нет спора',
          'не видно спора',
          'отсутствует спор',
          'спор отсутствует',
          'без конфликта',
          'отсутствуют противореч'
        ]
      ],
      mustIncludeAll: ['<b>Позиции</b>', '<b>Что видно</b>', '<b>Вердикт</b>'],
      mustMatchRegex: [
        '^<b>Позиции</b>[\\s\\S]+<b>Что видно</b>[\\s\\S]+<b>Вердикт</b>'
      ],
      mustNotIncludeAny: [['победил'], ['прав Саша', 'Саша права']],
      mustNotMatchRegex: ['(^|\\n)\\s*Summary\\s*:', '\\*\\*[^*]+\\*\\*']
    }
  }),
  createFixture({
    id: 'decide-subjective-dispute',
    intent: 'decide',
    targetDisplayName: 'Миша',
    rows: [
      ['2026-03-08T11:00:00.000Z', 'Миша', "elden ring лучше baldur's gate 3"],
      [
        '2026-03-08T11:01:00.000Z',
        'Оля',
        "нет, baldur's gate 3 лучше, там сюжет сильнее"
      ],
      [
        '2026-03-08T11:02:00.000Z',
        'Миша',
        'зато в elden ring исследование и бои круче'
      ],
      ['2026-03-08T11:03:00.000Z', 'Оля', 'это просто разные вкусы']
    ],
    triggerText: '/decide',
    rubric: {
      mustIncludeAny: [
        ['субъектив', 'вкус'],
        ['критери', 'разные'],
        ['объективн', 'однозначн', 'нет однозначного факта']
      ],
      mustIncludeAll: ['<b>Позиции</b>', '<b>Что видно</b>', '<b>Вердикт</b>'],
      mustMatchRegex: [
        '^<b>Позиции</b>[\\s\\S]+<b>Что видно</b>[\\s\\S]+<b>Вердикт</b>'
      ],
      mustNotIncludeAny: [
        ['Миша победил', 'Оля победила'],
        ['официально лучше']
      ],
      mustNotMatchRegex: ['(^|\\n)\\s*Summary\\s*:', '\\*\\*[^*]+\\*\\*']
    }
  }),
  createFixture({
    id: 'decide-entity-grounding-dispute',
    intent: 'decide',
    targetDisplayName: 'Артём',
    rows: [
      ['2026-04-17T20:10:00.000Z', 'Артём', 'кто лучше дора или мейби бэйби?'],
      ['2026-04-17T20:11:00.000Z', 'Артур', 'Дерьмишко или говнишко?'],
      [
        '2026-04-17T20:11:30.000Z',
        'Артур',
        'Мне концерт доры понравился больше!'
      ],
      [
        '2026-04-17T20:12:00.000Z',
        'Артём',
        'я думаю что дерьмишко, потому что говнишко это как-то токсично'
      ]
    ],
    triggerText: '/decide',
    lookupExpectation: {
      shouldLookup: true,
      purpose: 'entity_grounding',
      includeTerms: ['Дора', 'Мэйби Бэйби']
    },
    rubric: {
      mustIncludeAny: [
        ['Дора', 'Дор'],
        ['Мэйби', 'Maybe Baby'],
        ['субъектив', 'вкус'],
        ['концерт', 'концертный', 'выступлен']
      ],
      mustIncludeAll: ['<b>Позиции</b>', '<b>Что видно</b>', '<b>Вердикт</b>'],
      mustMatchRegex: [
        '^<b>Позиции</b>[\\s\\S]+<b>Что видно</b>[\\s\\S]+<b>Вердикт</b>'
      ],
      mustNotIncludeAny: [
        ['песни, а не соперники'],
        ['Дора — это песня'],
        ['Maybe Baby — это песня']
      ],
      mustNotMatchRegex: ['(^|\\n)\\s*Summary\\s*:', '\\*\\*[^*]+\\*\\*']
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
  assistantInstructions?: string;
  lookupExpectation?: IntentEvalFixture['lookupExpectation'];
  rubric: IntentEvalFixture['rubric'];
}): IntentEvalFixture {
  const priorContextMessages = input.rows.map<StoredMessage>(
    ([createdAt, senderDisplayName, text], index) => ({
      chatId: 1,
      messageId: index + 1,
      userId: index + 1,
      senderDisplayName,
      text,
      createdAt,
      isBot: senderDisplayName.toLowerCase().includes('бот'),
      replyToMessageId: null
    })
  );
  const anchorMessageId = 10_000;

  const fixture: IntentEvalFixture = {
    id: input.id,
    intent: input.intent,
    targetDisplayName: input.targetDisplayName,
    assistantInstructions:
      input.assistantInstructions ?? DEFAULT_ASSISTANT_INSTRUCTIONS,
    replyContext: {
      triggerMessage: {
        chatId: 1,
        messageId: input.rows.length + 1,
        userId: 999,
        senderDisplayName: input.targetDisplayName,
        text: input.triggerText,
        createdAt:
          priorContextMessages[priorContextMessages.length - 1]?.createdAt ??
          '2026-01-01T00:00:00.000Z',
        isBot: false,
        replyToMessageId: input.replyAnchorText ? anchorMessageId : null
      },
      replyAnchorMessage:
        input.replyAnchorText && input.intent === 'explain'
          ? {
              chatId: 1,
              messageId: anchorMessageId,
              userId: 555,
              senderDisplayName: 'Anchor User',
              text: input.replyAnchorText,
              createdAt:
                priorContextMessages[priorContextMessages.length - 1]
                  ?.createdAt ?? '2026-01-01T00:00:00.000Z',
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
