import { createFixture } from './factory.js';
import type { IntentEvalFixture } from './types.js';

export const replyIntentEvalFixtures: IntentEvalFixture[] = [
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
  }),
  createFixture({
    id: 'translate-basic-message',
    intent: 'translate',
    targetDisplayName: 'Артём',
    rows: [['2026-04-21T16:30:00.000Z', 'Артём', 'переведи']],
    triggerText: '/translate',
    replyAnchorText: 'Hello, see you tomorrow',
    rubric: {
      mustIncludeAny: [
        ['Привет', 'Здравствуйте'],
        ['увидимся', 'до завтра']
      ],
      mustIncludeAll: ['Текст сообщения:'],
      mustMatchRegex: ['^Текст сообщения:\\s*[\\s\\S]+'],
      mustNotIncludeAny: [
        ['Translate', 'translation'],
        ['перевод:', 'Перевод:'],
        ['I will', 'Here is']
      ],
      mustNotMatchRegex: ['\\*\\*[^*]+\\*\\*', '<b>', '(^|\\n)\\s*Summary\\s*:']
    }
  })
];
