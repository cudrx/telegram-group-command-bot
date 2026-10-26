import { createFixture } from './factory.js';
import type { IntentEvalFixture } from './types.js';

export const replyIntentEvalFixtures: IntentEvalFixture[] = [
  createFixture({
    id: 'answer-factual-question',
    intent: 'answer',
    targetDisplayName: 'Артём',
    rows: [['2026-04-21T16:10:00.000Z', 'Артём', 'кто такой путин?']],
    triggerText: '@hrupa_bot',
    replyAnchorText: 'кто такой путин?',
    lookupExpectation: {
      shouldLookup: false,
      purpose: 'none',
      includeTerms: []
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
        [
          '<b>Meaning</b>',
          '<b>In short</b>',
          '<b>Conclusion</b>',
          '<b>Positions</b>'
        ],
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
    id: 'answer-research-unfamiliar-slang',
    intent: 'answer',
    targetDisplayName: 'Алиса',
    rows: [],
    triggerText:
      '@hrupa_bot проверь по источникам значение интернет-сленга «гунер». Это точно про стрелка?',
    expectedMode: 'research',
    expectedMessageIds: [],
    lookupExpectation: {
      shouldLookup: true,
      purpose: 'entity_grounding',
      includeTerms: [],
      includeAnyTerms: ['гунер', 'gooner'],
      sources: [
        {
          title: 'Synthetic internet slang glossary',
          url: 'https://example.test/slang/gooner',
          content:
            'Synthetic evaluation source for the supplied chat example. «Гунер» (gooner) здесь — интернет-сленг о человеке, увлечённом порнографией и длительной мастурбацией. Это не gunner (стрелок) и не оценка конкретного участника чата. Анимешник — любитель аниме.',
          score: 1
        }
      ]
    },
    evaluation: {
      category: 'grounding',
      origin: 'authored synthetic slang verification scenario',
      criteria:
        'Объяснить значение «гунер» по предоставленным источникам, не путать gooner с gunner (стрелком). Отрицание вроде «не означает стрелка» допустимо; оценивать смысл определения, а не наличие отдельных слов. Не выдавать тестовый источник за авторитетный словарь.',
      requiredBotMessageIds: []
    },
    rubric: {
      mustIncludeAny: [],
      mustNotIncludeAny: [],
      mustMatchRegex: ['[\\s\\S]+']
    }
  }),
  createFixture({
    id: 'answer-research-current-release',
    intent: 'answer',
    targetDisplayName: 'Артём',
    rows: [],
    triggerText:
      '@hrupa_bot проверь по официальным источникам, какая сейчас стабильная версия Auroralab Ledger.',
    expectedMode: 'research',
    expectedMessageIds: [],
    lookupExpectation: {
      shouldLookup: true,
      purpose: 'freshness',
      includeTerms: ['Auroralab Ledger'],
      sources: [
        {
          title: 'Auroralab Ledger release notes',
          url: 'https://example.test/auroralab/releases',
          content:
            'Synthetic evaluation source. As of 24 October 2026, the latest stable release of Auroralab Ledger is 4.2.1, released on 23 October 2026. Version 5.0.0-beta is a prerelease, not stable.',
          score: 1
        }
      ]
    },
    rubric: {
      mustIncludeAny: [['4.2.1']],
      mustNotIncludeAny: [
        ['стабильная версия — 5.0.0', 'стабильная версия 5.0.0']
      ],
      mustMatchRegex: ['[\\s\\S]+']
    }
  }),
  createFixture({
    id: 'answer-does-not-mirror-hostility',
    intent: 'answer',
    targetDisplayName: 'Артём',
    rows: [
      [
        '2026-04-21T16:12:00.000Z',
        'Артём',
        'ты вообще тупой? сколько будет два плюс два, отвечай нормально'
      ]
    ],
    triggerText: '@hrupa_bot',
    replyAnchorText:
      'ты вообще тупой? сколько будет два плюс два, отвечай нормально',
    rubric: {
      mustIncludeAny: [['4', 'четыре', 'Четыре']],
      mustIncludeAll: [],
      mustMatchRegex: ['[\\s\\S]+'],
      mustNotIncludeAny: [
        ['сам тупой', 'сам дурак', 'идиот', 'дебил'],
        ['успокойся', 'следи за языком', 'научись разговаривать']
      ],
      mustNotMatchRegex: ['\\*\\*[^*]+\\*\\*']
    }
  }),
  createFixture({
    id: 'summarize-basic-discussion',
    intent: 'answer',
    targetDisplayName: 'Артём',
    rows: [
      ['2026-04-21T16:15:00.000Z', 'А', 'давайте закажем пиццу'],
      ['2026-04-21T16:16:00.000Z', 'Б', 'я не хочу пиццу, давайте суши'],
      ['2026-04-21T16:17:00.000Z', 'В', 'можно и то и то взять'],
      ['2026-04-21T16:18:00.000Z', 'А', 'ок давайте комбинировать']
    ],
    triggerText: '@hrupa_bot подведи итог обсуждения',
    rubric: {
      mustIncludeAny: [['пицц'], ['суш']],
      mustIncludeAll: [],
      mustMatchRegex: ['[\\s\\S]+'],
      mustNotIncludeAny: [
        ['кто прав'],
        ['правильное решение'],
        ['я считаю'],
        ['по моему мнению']
      ],
      mustNotMatchRegex: [
        '(^|\\n)\\s*Summary\\s*:',
        '\\*\\*[^*]+\\*\\*',
        '<b>Meaning</b>',
        '<b>In short</b>',
        '<b>Conclusion</b>'
      ]
    }
  }),
  createFixture({
    id: 'decide-basic-dispute',
    intent: 'answer',
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
    triggerText: '@hrupa_bot оцени спор и сравни аргументы',
    rubric: {
      mustIncludeAny: [
        ['PostgreSQL'],
        ['MongoDB'],
        ['транзакц'],
        ['схем'],
        ['JSON', 'json']
      ],
      mustIncludeAll: [],
      mustMatchRegex: ['[\\s\\S]+'],
      mustNotIncludeAny: [
        ['<b>Short Summary</b>', '<b>Takeaway</b>'],
        ['<b>Meaning</b>', '<b>In short</b>', '<b>Conclusion</b>'],
        ['Summary:'],
        ['officially', 'according to lookup']
      ],
      mustNotMatchRegex: ['\\*\\*[^*]+\\*\\*']
    }
  }),
  createFixture({
    id: 'decide-two-sided-dispute',
    intent: 'answer',
    targetDisplayName: 'Артём',
    rows: [
      ['2026-04-21T16:26:00.000Z', 'Алиса', 'поедем поездом: дешевле'],
      ['2026-04-21T16:27:00.000Z', 'Борис', 'лучше самолётом: быстрее']
    ],
    triggerText: '@hrupa_bot оцени спор и сравни аргументы',
    rubric: {
      mustIncludeAny: [['Алиса'], ['Борис'], ['поезд'], ['самолёт']],
      mustIncludeAll: [],
      mustMatchRegex: ['[\\s\\S]+'],
      mustNotIncludeAny: [
        ['третья сторона', 'третий участник'],
        ['идиот', 'глупый', 'тупой']
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
  }),
  createFixture({
    id: 'read-preserves-source-language',
    intent: 'read',
    targetDisplayName: 'Артём',
    rows: [['2026-04-21T16:32:00.000Z', 'Артём', 'прочитай аудио']],
    triggerText: '/read',
    mediaContext: {
      sourceCaption: null,
      visionDescription: null,
      ocrTextRu: null,
      ocrTextDefault: null,
      visionRaw: null,
      visionInterpretation: null,
      audioTranscript: {
        transcript: 'Please meet me at the station tomorrow morning.',
        language: 'en',
        sourceDurationSeconds: 4
      }
    },
    rubric: {
      mustIncludeAny: [['Please meet me at the station tomorrow morning']],
      mustIncludeAll: [],
      mustMatchRegex: ['[\\s\\S]+'],
      mustNotIncludeAny: [
        ['Встреть меня', 'Встречай меня', 'на станции завтра утром'],
        ['<b>', '<i>', '<code>']
      ],
      mustNotMatchRegex: ['\\*\\*[^*]+\\*\\*']
    }
  })
];
