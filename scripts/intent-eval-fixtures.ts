import { readFileSync } from 'node:fs';

import type {
  AssistantIntent,
  ReplyContext,
  StoredMessage
} from '../src/domain/models.js';
import type { DescribeMediaContext } from '../src/llm/prompts.js';

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
  mediaContext?: DescribeMediaContext;
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
    id: 'read-vision-meme',
    intent: 'read',
    targetDisplayName: 'Артём',
    rows: [['2026-04-21T16:00:00.000Z', 'Артём', 'что там на картинке?']],
    triggerText: '/read',
    mediaContext: {
      sourceCaption: null,
      visibleText: ['Leon, necesito que distraigas a Kingpin'],
      visualDetails: {
        type: 'vision',
        kind: 'screenshot',
        visibleText: ['Leon, necesito que distraigas a Kingpin'],
        namesMentionedInText: ['Leon', 'Kingpin'],
        visuallyPresentPeopleOrCharacters: [
          'Man in black mask and red logo',
          'Man in black jacket'
        ],
        objects: ['Light fixtures', 'Pillars'],
        scene: 'Indoor setting, possibly a hallway or corridor',
        actions: [
          'One man is wearing a mask and a red logo, the other man is wearing a black jacket'
        ],
        style: 'Dark and moody',
        uncertainty: ['The identity of the characters and context of the scene']
      },
      audioTranscript: null
    },
    rubric: {
      mustIncludeAny: [
        ['Leon', 'Леон'],
        ['Kingpin', 'Кингпин'],
        ['маск', 'шлем', 'куртк']
      ],
      mustIncludeAll: ['Original:', 'Leon', 'Kingpin'],
      mustNotIncludeAny: [
        [
          '<b>Что распознано</b>',
          '<b>Что можно предположить</b>',
          '<b>Вывод</b>'
        ],
        ['мем про', 'шутка в том', 'смысл в том'],
        ['атмосфер', 'мрачн', 'настроение', 'стиль'],
        ['фильм', 'сериал', 'игра'],
        ['боевик', 'триллер', 'экшн'],
        ['антагонист', 'миссия', 'сюжет']
      ],
      mustNotMatchRegex: ['(^|\\n)\\s*Summary\\s*:', '\\*\\*[^*]+\\*\\*']
    }
  }),
  createFixture({
    id: 'read-audio-transcript',
    intent: 'read',
    targetDisplayName: 'Артём',
    rows: [['2026-04-21T16:05:00.000Z', 'Артём', 'прочитай войс']],
    triggerText: '/read',
    mediaContext: {
      sourceCaption: null,
      visibleText: [],
      visualDetails: null,
      audioTranscript: {
        transcript: 'короче я буду минут через десять не начинайте без меня',
        language: 'ru',
        sourceDurationSeconds: 4
      }
    },
    rubric: {
      mustIncludeAny: [
        ['через десять', 'минут через десять'],
        ['не начинайте без меня']
      ],
      mustIncludeAll: [],
      mustMatchRegex: ['[\\s\\S]+'],
      mustNotIncludeAny: [
        ['<b>'],
        ['думаю', 'похоже', 'видимо'],
        ['смысл', 'значит', 'вывод'],
        ['это значит', 'имеется в виду'],
        ['пользователь просит', 'сообщение означает']
      ],
      mustNotMatchRegex: [
        '(^|\\n)\\s*Summary\\s*:',
        '\\*\\*[^*]+\\*\\*',
        '^\\s*•'
      ]
    }
  }),
  createFixture({
    id: 'answer-factual-question',
    intent: 'answer',
    targetDisplayName: 'Артём',
    rows: [['2026-04-21T16:10:00.000Z', 'Артём', 'кто такой путин?']],
    triggerText: '/answer',
    replyAnchorText: 'кто такой путин?',
    lookupExpectation: {
      shouldLookup: true,
      purpose: 'entity_grounding',
      includeTerms: ['Владимир Путин']
    },
    rubric: {
      mustIncludeAny: [
        ['Владимир Путин', 'Путин'],
        ['президент', 'политик'],
        ['Россия', 'России', 'российск']
      ],
      mustIncludeAll: [],
      mustMatchRegex: ['[\\s\\S]+'],
      mustNotIncludeAny: [
        ['<b>Смысл</b>', '<b>По сути</b>', '<b>Вывод</b>', '<b>Позиции</b>'],
        ['Пользователь спрашивает', 'это вопрос о', 'речь идет о'],
        ['вопрос означает', 'спрашивает о том', 'имеется в виду']
      ],
      mustNotMatchRegex: [
        '(^|\\n)\\s*Summary\\s*:',
        '\\*\\*[^*]+\\*\\*',
        '(?:^|\\n)\\s*•[\\s\\S]*(?:\\n\\s*•[\\s\\S]*){4,}'
      ]
    }
  }),
  createFixture({
    id: 'explain-factual-question-meaning',
    intent: 'explain',
    targetDisplayName: 'Артём',
    rows: [['2026-04-21T16:12:00.000Z', 'Артём', 'кто такой путин?']],
    triggerText: '/explain',
    replyAnchorText: 'кто такой путин?',
    rubric: {
      mustIncludeAny: [
        ['спрашивает', 'вопрос', 'хочет понять'],
        ['кто такой', 'что это за человек', 'личность', 'роль', 'роли'],
        ['Путин']
      ],
      mustIncludeAll: ['<b>Смысл</b>', '<b>По сути</b>', '<b>Вывод</b>'],
      mustMatchRegex: [
        '^<b>Смысл</b>[\\s\\S]+<b>По сути</b>[\\s\\S]+<b>Вывод</b>'
      ],
      mustNotIncludeAny: [
        ['президент России', 'президента России', 'российский политик'],
        ['родился', 'занимает пост', 'работал в']
      ],
      mustNotMatchRegex: ['(^|\\n)\\s*Summary\\s*:', '\\*\\*[^*]+\\*\\*']
    }
  }),
  createFixture({
    id: 'summarize-basic-discussion',
    intent: 'summarize',
    targetDisplayName: 'Артём',
    rows: [
      ['2026-04-21T16:15:00.000Z', 'А', 'давайте закажем пиццу'],
      ['2026-04-21T16:16:00.000Z', 'Б', 'я не хочу пиццу, давайте суши'],
      ['2026-04-21T16:17:00.000Z', 'В', 'можно и то и то взять'],
      ['2026-04-21T16:18:00.000Z', 'А', 'ок давайте комбинировать']
    ],
    triggerText: '/summarize',
    rubric: {
      mustIncludeAny: [['пицц'], ['суш']],
      mustIncludeAll: ['<b>Коротко</b>', '<b>Итог</b>'],
      mustMatchRegex: ['^<b>Коротко</b>[\\s\\S]+<b>Итог</b>'],
      mustNotIncludeAny: [
        ['кто прав'],
        ['правильное решение'],
        ['я считаю'],
        ['по моему мнению']
      ],
      mustNotMatchRegex: [
        '(^|\\n)\\s*Summary\\s*:',
        '\\*\\*[^*]+\\*\\*',
        '<b>Смысл</b>',
        '<b>По сути</b>',
        '<b>Вывод</b>'
      ]
    }
  }),
  createFixture({
    id: 'decide-basic-dispute',
    intent: 'decide',
    targetDisplayName: 'Артём',
    rows: [
      [
        '2026-04-21T16:20:00.000Z',
        'А',
        'надо брать PostgreSQL, потому что у нас уже всё на SQL и нужны транзакции'
      ],
      ['2026-04-21T16:21:00.000Z', 'Б', 'давайте MongoDB, она гибче по схеме'],
      [
        '2026-04-21T16:22:00.000Z',
        'В',
        'у нас платежи и отчёты, без транзакций будет больно'
      ],
      ['2026-04-21T16:23:00.000Z', 'Б', 'но JSON хранить удобнее'],
      [
        '2026-04-21T16:24:00.000Z',
        'А',
        'JSON и в PostgreSQL можно хранить, а транзакции нам критичны'
      ]
    ],
    triggerText: '/decide',
    rubric: {
      mustIncludeAny: [
        ['PostgreSQL'],
        ['MongoDB'],
        ['транзакц'],
        ['схем'],
        ['JSON', 'json']
      ],
      mustIncludeAll: ['<b>Позиции</b>', '<b>Что видно</b>', '<b>Вердикт</b>'],
      mustMatchRegex: [
        '^<b>Позиции</b>[\\s\\S]+<b>Что видно</b>[\\s\\S]+<b>Вердикт</b>'
      ],
      mustNotIncludeAny: [
        ['<b>Коротко</b>', '<b>Итог</b>'],
        ['<b>Смысл</b>', '<b>По сути</b>', '<b>Вывод</b>'],
        ['Summary:'],
        ['официально', 'по данным']
      ],
      mustNotMatchRegex: ['\\*\\*[^*]+\\*\\*']
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
  mediaContext?: DescribeMediaContext;
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
        input.replyAnchorText &&
        (input.intent === 'explain' || input.intent === 'answer')
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

  if (input.mediaContext) {
    fixture.mediaContext = input.mediaContext;
  }

  if (input.lookupExpectation) {
    fixture.lookupExpectation = input.lookupExpectation;
  }

  return fixture;
}
