import { createFixture } from './factory.js';
import type { IntentEvalFixture } from './types.js';

export const readIntentEvalFixtures: IntentEvalFixture[] = [
  createFixture({
    id: 'read-vision-meme',
    intent: 'read',
    targetDisplayName: 'Артём',
    rows: [['2026-04-21T16:00:00.000Z', 'Артём', 'что там на картинке?']],
    triggerText: '/read',
    mediaContext: {
      sourceCaption: null,
      visionDescription: null,
      ocrTextRu: null,
      ocrTextDefault: null,
      visionRaw:
        'The image shows two men standing in a dim hallway. Visible text: "Leon, necesito que distraigas a Kingpin".',
      visionInterpretation:
        'Это мемный кадр: двое мужчин стоят в коридоре, а текст намекает, что один просит другого отвлечь Кингпина.',
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
    id: 'read-ocr-image-receipt',
    intent: 'read',
    targetDisplayName: 'Артём',
    rows: [['2026-04-21T16:02:00.000Z', 'Артём', 'что написано на чеке?']],
    triggerText: '/read',
    mediaContext: {
      sourceCaption: null,
      visionDescription:
        'A small paper receipt photographed on a table. The text is the main content.',
      ocrTextRu: 'МАГАЗИН РОМАШКА\nХЛЕБ 1 x 120,00\nИТОГО 120,00',
      ocrTextDefault: 'MAGAZIN ROMASHKA\nKHLEB 1 x 120.00\nITOGO 120.00',
      visionRaw: null,
      visionInterpretation: null,
      audioTranscript: null
    },
    rubric: {
      mustIncludeAny: [['ХЛЕБ', 'KHLEB'], ['ИТОГО', 'ITOGO'], ['120']],
      mustIncludeAll: ['Original:', '120'],
      mustNotIncludeAny: [
        [
          '<b>Что распознано</b>',
          '<b>Что можно предположить</b>',
          '<b>Вывод</b>'
        ],
        ['мем про', 'шутка в том', 'смысл в том'],
        ['думаю', 'похоже', 'видимо'],
        ['вывод', 'итог:', 'summary:']
      ],
      mustNotMatchRegex: ['\\*\\*[^*]+\\*\\*']
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
      visionDescription: null,
      ocrTextRu: null,
      ocrTextDefault: null,
      visionRaw: null,
      visionInterpretation: null,
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
  })
];
