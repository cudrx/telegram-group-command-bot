import type { OpenAiCompatibleLlmClient } from '../../src/llm/openai-compatible-client/index.js';

export function createClientConfig() {
  return {
    apiKey: 'key',
    baseUrl: 'https://example.com',
    replyModel: 'reply-model',
    replyTemperature: 0.6,
    replyEnableThinking: false,
    plannerModel: 'planner-model',
    lookupMaxQueries: 1,
    timeoutMs: 20_000,
    maxRetries: 1
  };
}

export function createOpenAiStub(content: string) {
  return {
    chat: {
      completions: {
        create: async () => ({
          choices: [
            {
              message: {
                content
              }
            }
          ]
        })
      }
    }
  } as never;
}

export function createReplyInput(
  intent: 'explain' | 'summarize' | 'decide' | 'read' | 'answer' = 'decide'
): Parameters<OpenAiCompatibleLlmClient['generateReply']>[0] {
  return {
    assistantInstructions: 'Assistant instructions',
    targetDisplayName: 'Tom',
    intent,
    replyContext: {
      triggerMessage: {
        chatId: 1,
        messageId: 3,
        userId: 42,
        senderDisplayName: 'Tom',
        text: '/decide кто прав',
        createdAt: '2026-04-03T12:02:00.000Z',
        isBot: false,
        replyToMessageId: null
      },
      replyAnchorMessage: null,
      priorContextMessages: []
    },
    mediaContext:
      intent === 'read'
        ? {
            sourceCaption: null,
            visionDescription: null,
            ocrTextRu: null,
            ocrTextDefault: null,
            visionRaw: null,
            visionInterpretation: null,
            audioTranscript: null
          }
        : null
  };
}
