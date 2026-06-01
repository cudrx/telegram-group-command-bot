export const language = {
  targetLanguageName: 'Russian',
  ocrProviderLanguageCode: 'rus'
} as const;

export const text = {
  assistant: {
    displayName: 'Пруфик'
  },
  answer: {
    usageFallback: 'Сделай reply на сообщение с вопросом и отправь /answer.'
  },
  translate: {
    headers: {
      messageText: 'Текст сообщения',
      caption: 'Подпись',
      imageText: 'Текст на картинке',
      audioTranscript: 'Расшифровка аудио',
      imageDescription: 'Описание изображения'
    },
    usageFallback: 'Сделай reply на сообщение и отправь /translate.',
    noMaterialFallback:
      'Нечего переводить: сделай reply на текст, подпись, картинку или голосовое.',
    alreadyTargetLanguageFallback: 'Похоже, это уже на русском.'
  },
  read: {
    usageFallback: 'Сделай reply на текстовое сообщение и отправь /read.',
    tooLongFallback: (maxChars: number) =>
      `Сообщение слишком длинное, я могу прочитать только до ${maxChars} символов.`,
    failedFallback: 'Не удалось озвучить сообщение. Попробуй позже.',
    cooldownFallback: (limit: number, minutes: number) =>
      `Я уже прочитал ${limit} сообщения за час в этом чате. Попробуй через ${minutes} мин.`
  },
  transcribe: {
    usageFallback: 'Сделай reply на видео и отправь /transcribe.',
    unavailableFallback: 'Распознавание видео сейчас не настроено.',
    failedFallback: 'Не удалось расшифровать видео. Попробуй позже.',
    emptyFallback: 'Не получилось найти речь в этом видео.'
  },
  publish: {
    missingTarget:
      'Не нашел сообщение для /publish. Сделай reply или отправь команду после сообщения.',
    copyFailed: 'Telegram не дал скопировать это сообщение.'
  },
  meme: {
    fallback: 'Мемы закончились, идите трогайте траву.'
  },
  llm: {
    replySystem: `You are a neutral Telegram assistant. Respond helpfully and concisely in ${language.targetLanguageName}.`,
    deployUpdateSystem: `You format concise Telegram release updates in ${language.targetLanguageName}.`,
    evalSystem: `You are a careful Telegram chat assistant. Answer in ${language.targetLanguageName}.`
  }
} as const;

export const patterns = {
  translate: {
    blockHeaderAtStart:
      /^(Текст сообщения|Подпись|Текст на картинке|Расшифровка аудио|Описание изображения):/u,
    replyHeaderLine:
      /^ *(?:<b>)?(Текст сообщения|Подпись|Текст на картинке|Расшифровка аудио|Описание изображения):(?:<\/b>)? *$/u
  },
  languageDetection: {
    specificLetters: /[ёыэъ]/gu,
    commonWords:
      /(?:^|[^\p{L}])(и|в|во|не|на|что|это|как|дела|привет|я|ты|он|она|мы|вы|они|уже|русском|русский|для|с|со|по|из|за|к|ко|от|до)(?=$|[^\p{L}])/gu,
    commonShortText:
      /(?:^|[^\p{L}])(спасибо|хорошо|понял|поняла|понятно|согласен|согласна|можно|нельзя|давай|ладно|москва)(?=$|[^\p{L}])/gu
  }
} as const;
