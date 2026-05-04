import type { MediaMessageSnapshot } from '../../../domain/models.js';
import { loadPrompt } from '../../../llm/prompt-files.js';
import {
  addDaysIso,
  IMAGE_INTERPRETATION_ARTIFACT_KIND,
  IMAGE_INTERPRETATION_PROVIDER
} from '../helpers/media.js';
import type { ChatOrchestratorDeps, ReplyRequest } from '../types.js';

export async function generateAndStoreVisionInterpretation(
  deps: Pick<ChatOrchestratorDeps, 'db' | 'env' | 'now' | 'qwen'>,
  input: {
    request: ReplyRequest;
    media: MediaMessageSnapshot;
    visionDescription: string | null;
    ocrTextRu: string | null;
    ocrTextDefault: string | null;
  }
): Promise<string | null> {
  const result = await deps.qwen.generateReply({
    assistantInstructions: loadPrompt('base'),
    targetDisplayName: input.request.fromDisplayName,
    intent: 'read',
    replyContext: {
      triggerMessage: {
        chatId: input.request.chatId,
        messageId: input.media.messageId,
        userId: null,
        senderDisplayName: 'Media',
        text: '/read',
        createdAt: input.request.createdAt,
        isBot: false,
        replyToMessageId: null
      },
      replyAnchorMessage: null,
      priorContextMessages: []
    },
    lookupContext: null,
    mediaContext: {
      sourceCaption: input.media.caption,
      visionDescription: input.visionDescription,
      ocrTextRu: input.ocrTextRu,
      ocrTextDefault: input.ocrTextDefault,
      visionRaw: null,
      visionInterpretation: null,
      audioTranscript: null
    }
  });
  const createdAt = deps.now();

  deps.db.saveMediaArtifact({
    fileUniqueId: input.media.fileUniqueId,
    chatId: input.request.chatId,
    telegramMessageId: input.media.messageId,
    mediaKind: input.media.mediaKind,
    provider: IMAGE_INTERPRETATION_PROVIDER,
    providerModel: result.model,
    artifactKind: IMAGE_INTERPRETATION_ARTIFACT_KIND,
    artifactStatus: 'success',
    artifactText: result.text,
    artifactJson: { text: result.text },
    rawResponseJson: {
      model: result.model,
      latencyMs: result.latencyMs,
      attemptCount: result.attemptCount,
      promptTokensEstimate: result.promptTokensEstimate
    },
    sourceCaption: input.media.caption,
    sourceMimeType: input.media.mimeType,
    sourceFileSize: input.media.fileSize,
    sourceDurationSeconds: null,
    recognitionLanguage: null,
    confidenceJson: null,
    errorText: null,
    createdAt,
    expiresAt: addDaysIso(createdAt, deps.env.mediaArtifactRetentionDays)
  });

  return result.text;
}
