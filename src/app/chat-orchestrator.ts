import { randomUUID } from 'node:crypto';

import type { AppEnv } from '../config/env.js';
import type {
  AssistantIntent,
  MediaMessageSnapshot,
  NormalizedMessage,
  ReplyContext,
  StoredMessage
} from '../domain/models.js';
import {
  decideReplyAction,
  detectDirectTrigger
} from '../domain/response-policy.js';
import type {
  LlmReplyResult,
  LookupPlanResult
} from '../llm/openai-compatible-llm-client.js';
import { loadPrompt } from '../llm/prompt-files.js';
import type { DescribeMediaContext } from '../llm/prompts.js';
import { type AppLogger, serializeError } from '../logging/logger.js';
import type {
  LookupContext,
  LookupDecision,
  LookupIntent,
  LookupProvider
} from '../lookup/types.js';
import { downloadTelegramFileToTemp } from '../media/telegram-media.js';
import type {
  NormalizedMediaArtifact,
  SpeechToTextProvider,
  VisionProvider
} from '../media/types.js';
import type {
  DatabaseClient,
  StoredMediaArtifact
} from '../storage/database.js';
import { buildReplyContext } from './reply-context-builder.js';
import { formatTelegramHtmlReply } from './telegram-html.js';
import { withTypingIndicator } from './typing-indicator.js';

export type BotIdentity = {
  userId: number;
  username: string | null;
  displayName: string;
};

export type SentBotMessage = {
  messageId: number;
  createdAt: string;
};

export type ReplyDispatcher = (input: {
  chatId: number;
  replyToMessageId: number;
  text: string;
}) => Promise<SentBotMessage>;

export type LlmClient = {
  generateReply(input: {
    assistantInstructions: string;
    targetDisplayName: string;
    intent: AssistantIntent;
    replyContext: ReplyContext;
    lookupContext?: LookupContext | null;
    mediaContext?: DescribeMediaContext | null;
  }): Promise<LlmReplyResult>;
  planLookup(input: {
    intent: LookupIntent;
    replyContext: ReplyContext;
  }): Promise<LookupPlanResult>;
};

type ReplyRequest = {
  chatId: number;
  chatType: string;
  chatTitle: string | null;
  triggerMessageId: number;
  fromDisplayName: string;
  createdAt: string;
  intent: AssistantIntent;
  replyToMessageSnapshot: StoredMessage | null;
  replyToMediaSnapshot: MediaMessageSnapshot | null;
};

const EXPLAIN_USAGE_PLACEHOLDER =
  'Сделай reply на сообщение с вопросом и отправь /explain.';
const ANSWER_USAGE_PLACEHOLDER =
  'Сделай reply на сообщение с вопросом и отправь /answer.';
const READ_USAGE_PLACEHOLDER =
  'Сделай reply на голосовое, кружочек или картинку и отправь /read.';
const READ_DISABLED_PLACEHOLDER = 'Распознавание медиа сейчас выключено.';
const READ_FAILED_PLACEHOLDER =
  'Не удалось распознать медиа. Попробуй позже или с другим файлом.';
const NEARBY_MEDIA_SCAN_LIMIT = 10;
const IMAGE_RAW_PROVIDER = 'cloudflare';
const IMAGE_RAW_ARTIFACT_KIND = 'vision_raw';
const IMAGE_INTERPRETATION_PROVIDER = 'deepseek';
const IMAGE_INTERPRETATION_ARTIFACT_KIND = 'vision_interpretation';

export class ChatOrchestrator {
  constructor(
    private readonly deps: {
      db: DatabaseClient;
      qwen: LlmClient;
      env: AppEnv;
      lookupProvider: LookupProvider | null;
      speechToTextProvider?: SpeechToTextProvider | null;
      visionProvider?: VisionProvider | null;
      telegramFileApi?: {
        getFile(fileId: string): Promise<{ file_path?: string | null }>;
      } | null;
      fetch?: typeof fetch | undefined;
      bot: BotIdentity;
      replyDispatcher: ReplyDispatcher;
      sendTyping: (chatId: number) => Promise<void>;
      delay: (ms: number) => Promise<void>;
      logger: AppLogger;
      now: () => string;
      random: () => number;
    }
  ) {}

  async handleIncomingMessage(message: NormalizedMessage): Promise<void> {
    const correlationId = randomUUID();
    const logger = this.deps.logger.child({
      correlationId,
      chatId: message.chatId,
      messageId: message.messageId
    });
    const stored = this.deps.db.saveIncomingMessage(message);

    if (!stored) {
      logger.debug('incoming_message_ignored_duplicate');
      return;
    }

    const chatState = this.deps.db.getChatState(message.chatId);

    if (!chatState) {
      logger.warn('chat_state_missing_after_save');
      return;
    }

    const directTrigger = detectDirectTrigger({
      botUserId: this.deps.bot.userId,
      botUsername: this.deps.bot.username,
      message: {
        chatType: message.chatType,
        text: message.text,
        entities: message.entities,
        replyToUserId: message.replyToUserId
      }
    });
    const decision = decideReplyAction({ directTrigger });

    logger.debug('incoming_message_evaluated', {
      directTrigger,
      decision: decision.reason,
      intent: decision.intent
    });

    if (!decision.shouldReply) {
      return;
    }

    if (!decision.intent) {
      return;
    }

    const request: ReplyRequest = {
      chatId: message.chatId,
      chatType: message.chatType,
      chatTitle: message.chatTitle,
      triggerMessageId: message.messageId,
      fromDisplayName: message.fromDisplayName,
      createdAt: message.createdAt,
      intent: decision.intent,
      replyToMessageSnapshot: message.replyToMessageSnapshot,
      replyToMediaSnapshot: message.replyToMediaSnapshot
    };

    await this.runReplyJob(request, logger);
  }

  private async runReplyJob(
    request: ReplyRequest,
    logger: AppLogger
  ): Promise<void> {
    try {
      logger.debug('reply_job_started', {
        intent: request.intent,
        replyToMessageId: request.triggerMessageId
      });

      const result = await this.executeReplyGeneration(request, logger);

      if (!result) {
        logger.debug('reply_job_skipped', {
          intent: request.intent,
          replyToMessageId: request.triggerMessageId
        });
        return;
      }

      const replyText = formatTelegramHtmlReply(result.text, {
        intent: request.intent
      });

      const sent = await this.deps.replyDispatcher({
        chatId: request.chatId,
        replyToMessageId: request.triggerMessageId,
        text: replyText
      });

      this.deps.db.saveBotMessage({
        chatId: request.chatId,
        chatType: request.chatType,
        chatTitle: request.chatTitle,
        messageId: sent.messageId,
        text: replyText,
        createdAt: sent.createdAt,
        userId: this.deps.bot.userId,
        username: this.deps.bot.username,
        displayName: this.deps.bot.displayName,
        replyToMessageId: request.triggerMessageId
      });

      logger.debug('reply_job_completed', {
        intent: request.intent,
        replyToMessageId: request.triggerMessageId,
        llmLatencyMs: result.latencyMs,
        llmAttempts: result.attemptCount,
        llmModel: result.model,
        promptTokensEstimate: result.promptTokensEstimate
      });
    } catch (error) {
      logger.error('reply_job_failed', {
        intent: request.intent,
        ...serializeError(error)
      });
    }
  }

  private async executeReplyGeneration(
    request: ReplyRequest,
    logger: AppLogger
  ): Promise<LlmReplyResult | null> {
    if (request.intent === 'read') {
      return this.executeReadGeneration(request, logger);
    }

    let replyContext = withReplySnapshotFallback(
      buildReplyContext({
        db: this.deps.db,
        chatId: request.chatId,
        triggerMessageId: request.triggerMessageId,
        contextLimit: getContextLimitForIntent(this.deps.env, request.intent),
        intent: request.intent,
        botUserId: this.deps.bot.userId
      }),
      {
        intent: request.intent,
        botUserId: this.deps.bot.userId,
        replyToMessageSnapshot: request.replyToMessageSnapshot
      }
    );

    if (
      (request.intent === 'explain' || request.intent === 'answer') &&
      !replyContext.replyAnchorMessage
    ) {
      logger.warn(`${request.intent}_anchor_missing`, {
        replyToMessageId: replyContext.triggerMessage?.replyToMessageId ?? null,
        replyToUserId: request.replyToMessageSnapshot?.userId ?? null
      });

      return createLocalReplyResult(
        request.intent === 'answer'
          ? ANSWER_USAGE_PLACEHOLDER
          : EXPLAIN_USAGE_PLACEHOLDER
      );
    }

    replyContext = await this.enrichReplyContextWithNearbyMedia(
      request,
      replyContext,
      logger
    );
    const targetMediaContext = await this.buildTargetMediaContext(
      request,
      replyContext,
      logger
    );

    return this.withReplyTyping(request.chatId, async () => {
      const assistantInstructions = loadPrompt('base');
      const lookupContext = await this.buildLookupContext({
        intent: request.intent,
        replyContext,
        logger
      });

      return this.deps.qwen.generateReply({
        assistantInstructions,
        targetDisplayName: request.fromDisplayName,
        intent: request.intent,
        replyContext,
        lookupContext,
        mediaContext: targetMediaContext
      });
    });
  }

  private async executeReadGeneration(
    request: ReplyRequest,
    logger: AppLogger
  ): Promise<LlmReplyResult> {
    if (!this.deps.env.mediaAnalysisEnabled) {
      return createLocalReplyResult(READ_DISABLED_PLACEHOLDER);
    }

    const media = request.replyToMediaSnapshot;

    if (!media) {
      return createLocalReplyResult(READ_USAGE_PLACEHOLDER);
    }

    const mediaContext = await this.ensureMediaContext({
      request,
      media,
      logger
    });

    if (!mediaContext) {
      return createLocalReplyResult(READ_FAILED_PLACEHOLDER);
    }

    if (media.mediaKind === 'photo' || media.mediaKind === 'document_image') {
      const interpreted =
        mediaContext.visionInterpretation ?? mediaContext.visionRaw;

      if (!interpreted) {
        return createLocalReplyResult(READ_FAILED_PLACEHOLDER);
      }

      return createLocalReplyResult(interpreted);
    }

    const replyContext = buildReplyContext({
      db: this.deps.db,
      chatId: request.chatId,
      triggerMessageId: request.triggerMessageId,
      contextLimit: this.deps.env.readContextLimit,
      intent: request.intent,
      botUserId: this.deps.bot.userId
    });

    return this.withReplyTyping(request.chatId, async () =>
      this.deps.qwen.generateReply({
        assistantInstructions: loadPrompt('base'),
        targetDisplayName: request.fromDisplayName,
        intent: request.intent,
        replyContext,
        lookupContext: null,
        mediaContext
      })
    );
  }

  private async recognizeAndStoreMediaArtifact(input: {
    request: ReplyRequest;
    media: MediaMessageSnapshot;
    provider: 'gladia';
    artifactKind: 'transcript';
    logger: AppLogger;
  }): Promise<{
    artifact: NormalizedMediaArtifact;
    sourceDurationSeconds: number | null;
  } | null> {
    const telegramFileApi = this.deps.telegramFileApi;

    if (!telegramFileApi) {
      input.logger.warn('describe_telegram_file_api_missing');
      return null;
    }

    let downloaded: Awaited<
      ReturnType<typeof downloadTelegramFileToTemp>
    > | null = null;

    try {
      downloaded = await downloadTelegramFileToTemp({
        api: telegramFileApi,
        botToken: this.deps.env.telegramBotToken,
        fileId: input.media.fileId,
        filename: createMediaFilename(input.media),
        maxBytes: this.deps.env.mediaMaxFileBytes,
        fileSize: input.media.fileSize,
        fetch: this.deps.fetch
      });

      const result = await this.transcribeDownloadedMedia(
        input.media,
        downloaded.filePath
      );
      const createdAt = this.deps.now();

      this.deps.db.saveMediaArtifact({
        fileUniqueId: input.media.fileUniqueId,
        chatId: input.request.chatId,
        telegramMessageId: input.media.messageId,
        mediaKind: input.media.mediaKind,
        provider: result.provider,
        providerModel: result.providerModel,
        artifactKind: input.artifactKind,
        artifactStatus: 'success',
        artifactText: artifactToText(result.artifact),
        artifactJson: result.artifact,
        rawResponseJson: result.rawResponse,
        sourceCaption: input.media.caption,
        sourceMimeType: input.media.mimeType,
        sourceFileSize: input.media.fileSize ?? downloaded.bytes,
        sourceDurationSeconds: result.sourceDurationSeconds ?? null,
        recognitionLanguage:
          result.artifact.type === 'transcript'
            ? result.artifact.language
            : null,
        confidenceJson: null,
        errorText: null,
        createdAt,
        expiresAt: addDaysIso(
          createdAt,
          this.deps.env.mediaArtifactRetentionDays
        )
      });

      return {
        artifact: result.artifact,
        sourceDurationSeconds: result.sourceDurationSeconds ?? null
      };
    } catch (error) {
      input.logger.warn('describe_media_recognition_failed', {
        provider: input.provider,
        mediaKind: input.media.mediaKind,
        ...serializeError(error)
      });

      return null;
    } finally {
      if (downloaded) {
        await downloaded.cleanup();
      }
    }
  }

  private async buildTargetMediaContext(
    request: ReplyRequest,
    replyContext: ReplyContext,
    logger: AppLogger
  ): Promise<DescribeMediaContext | null> {
    if (request.intent !== 'explain' && request.intent !== 'answer') {
      return null;
    }

    const targetMedia = this.getTargetMediaSnapshot(request, replyContext);

    if (!targetMedia) {
      return null;
    }

    return this.ensureMediaContext({
      request,
      media: targetMedia,
      logger
    });
  }

  private getTargetMediaSnapshot(
    request: ReplyRequest,
    replyContext: ReplyContext
  ): MediaMessageSnapshot | null {
    return (
      request.replyToMediaSnapshot ??
      replyContext.replyAnchorMessage?.mediaSnapshot ??
      null
    );
  }

  private async enrichReplyContextWithNearbyMedia(
    request: ReplyRequest,
    replyContext: ReplyContext,
    logger: AppLogger
  ): Promise<ReplyContext> {
    if (
      request.intent !== 'explain' &&
      request.intent !== 'decide' &&
      request.intent !== 'answer'
    ) {
      return replyContext;
    }

    const nearbyWindow = this.deps.db.getMessagesBefore(
      request.chatId,
      request.triggerMessageId,
      NEARBY_MEDIA_SCAN_LIMIT
    );
    const nearbyMediaMessages = nearbyWindow.filter(
      (message) => message.mediaSnapshot
    );

    const newestMediaMessage =
      nearbyMediaMessages[nearbyMediaMessages.length - 1] ?? null;

    if (newestMediaMessage?.mediaSnapshot) {
      const hasCached = this.getPreferredMediaSummary(
        this.deps.db.getSuccessfulMediaArtifactsForMessages({
          chatId: request.chatId,
          messageIds: [newestMediaMessage.messageId]
        }),
        newestMediaMessage.messageId,
        newestMediaMessage.mediaSnapshot.mediaKind
      );

      if (!hasCached) {
        await this.ensureMediaContext({
          request,
          media: newestMediaMessage.mediaSnapshot,
          logger
        });
      }
    }

    const cachedArtifacts = this.deps.db.getSuccessfulMediaArtifactsForMessages(
      {
        chatId: request.chatId,
        messageIds: nearbyMediaMessages.map((message) => message.messageId)
      }
    );
    const messagesById = new Map<number, StoredMessage>();

    for (const message of replyContext.priorContextMessages) {
      messagesById.set(message.messageId, { ...message });
    }

    for (const message of nearbyMediaMessages) {
      const mediaSnapshot = message.mediaSnapshot;

      if (!mediaSnapshot) {
        continue;
      }

      const summary = this.getPreferredMediaSummary(
        cachedArtifacts,
        message.messageId,
        mediaSnapshot.mediaKind
      );

      if (!summary) {
        continue;
      }

      messagesById.set(message.messageId, {
        ...message,
        text: appendMediaSummaryToMessageText(message.text, summary)
      });
    }

    return {
      ...replyContext,
      priorContextMessages: Array.from(messagesById.values()).sort(
        (left, right) => left.messageId - right.messageId
      )
    };
  }

  private getPreferredMediaSummary(
    artifacts: StoredMediaArtifact[],
    messageId: number,
    mediaKind: MediaMessageSnapshot['mediaKind']
  ): string | null {
    const matching = artifacts.filter(
      (artifact) => artifact.telegramMessageId === messageId
    );

    if (matching.length === 0) {
      return null;
    }

    if (mediaKind === 'photo' || mediaKind === 'document_image') {
      return (
        matching.find(
          (artifact) =>
            artifact.artifactKind === IMAGE_INTERPRETATION_ARTIFACT_KIND
        )?.artifactText ??
        matching.find(
          (artifact) => artifact.artifactKind === IMAGE_RAW_ARTIFACT_KIND
        )?.artifactText ??
        null
      );
    }

    return (
      matching.find((artifact) => artifact.artifactKind === 'transcript')
        ?.artifactText ?? null
    );
  }

  private async ensureMediaContext(input: {
    request: ReplyRequest;
    media: MediaMessageSnapshot;
    logger: AppLogger;
  }): Promise<DescribeMediaContext | null> {
    if (
      input.media.mediaKind === 'photo' ||
      input.media.mediaKind === 'document_image'
    ) {
      return this.ensureImageMediaContext(input);
    }

    const cached = this.deps.db.getSuccessfulMediaArtifact({
      fileUniqueId: input.media.fileUniqueId,
      chatId: input.request.chatId,
      telegramMessageId: input.media.messageId,
      provider: 'gladia',
      artifactKind: 'transcript'
    });
    const recognized = cached
      ? artifactFromStoredMediaArtifact(cached.artifactJson)
      : await this.recognizeAndStoreMediaArtifact({
          request: input.request,
          media: input.media,
          provider: 'gladia',
          artifactKind: 'transcript',
          logger: input.logger
        });

    if (!recognized) {
      return null;
    }

    return buildTranscriptMediaContext({
      media: input.media,
      artifact: recognized.artifact,
      sourceDurationSeconds: recognized.sourceDurationSeconds
    });
  }

  private async ensureImageMediaContext(input: {
    request: ReplyRequest;
    media: MediaMessageSnapshot;
    logger: AppLogger;
  }): Promise<DescribeMediaContext | null> {
    let visionRaw =
      this.deps.db.getSuccessfulMediaArtifact({
        fileUniqueId: input.media.fileUniqueId,
        chatId: input.request.chatId,
        telegramMessageId: input.media.messageId,
        provider: IMAGE_RAW_PROVIDER,
        artifactKind: IMAGE_RAW_ARTIFACT_KIND
      })?.artifactText ?? null;

    if (!visionRaw) {
      visionRaw = await this.generateAndStoreVisionRaw(input);
    }

    if (!visionRaw) {
      return null;
    }

    let visionInterpretation =
      this.deps.db.getSuccessfulMediaArtifact({
        fileUniqueId: input.media.fileUniqueId,
        chatId: input.request.chatId,
        telegramMessageId: input.media.messageId,
        provider: IMAGE_INTERPRETATION_PROVIDER,
        artifactKind: IMAGE_INTERPRETATION_ARTIFACT_KIND
      })?.artifactText ?? null;

    if (!visionInterpretation) {
      visionInterpretation = await this.generateAndStoreVisionInterpretation({
        request: input.request,
        media: input.media,
        visionRaw
      });
    }

    return {
      sourceCaption: input.media.caption,
      visionRaw,
      visionInterpretation,
      audioTranscript: null
    };
  }

  private async generateAndStoreVisionRaw(input: {
    request: ReplyRequest;
    media: MediaMessageSnapshot;
    logger: AppLogger;
  }): Promise<string | null> {
    const telegramFileApi = this.deps.telegramFileApi;

    if (!telegramFileApi) {
      input.logger.warn('describe_telegram_file_api_missing');
      return null;
    }

    let downloaded: Awaited<
      ReturnType<typeof downloadTelegramFileToTemp>
    > | null = null;

    try {
      downloaded = await downloadTelegramFileToTemp({
        api: telegramFileApi,
        botToken: this.deps.env.telegramBotToken,
        fileId: input.media.fileId,
        filename: createMediaFilename(input.media),
        maxBytes: this.deps.env.mediaMaxFileBytes,
        fileSize: input.media.fileSize,
        fetch: this.deps.fetch
      });

      const result = await this.describeDownloadedImage(downloaded.filePath);
      const createdAt = this.deps.now();

      this.deps.db.saveMediaArtifact({
        fileUniqueId: input.media.fileUniqueId,
        chatId: input.request.chatId,
        telegramMessageId: input.media.messageId,
        mediaKind: input.media.mediaKind,
        provider: result.provider,
        providerModel: result.providerModel,
        artifactKind: IMAGE_RAW_ARTIFACT_KIND,
        artifactStatus: 'success',
        artifactText: result.rawText,
        artifactJson: { text: result.rawText },
        rawResponseJson: result.rawResponse,
        sourceCaption: input.media.caption,
        sourceMimeType: input.media.mimeType,
        sourceFileSize: input.media.fileSize ?? downloaded.bytes,
        sourceDurationSeconds: null,
        recognitionLanguage: null,
        confidenceJson: null,
        errorText: null,
        createdAt,
        expiresAt: addDaysIso(
          createdAt,
          this.deps.env.mediaArtifactRetentionDays
        )
      });

      return result.rawText;
    } catch (error) {
      input.logger.warn('describe_media_recognition_failed', {
        provider: IMAGE_RAW_PROVIDER,
        mediaKind: input.media.mediaKind,
        ...serializeError(error)
      });

      return null;
    } finally {
      if (downloaded) {
        await downloaded.cleanup();
      }
    }
  }

  private async generateAndStoreVisionInterpretation(input: {
    request: ReplyRequest;
    media: MediaMessageSnapshot;
    visionRaw: string;
  }): Promise<string | null> {
    const result = await this.deps.qwen.generateReply({
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
        visionRaw: input.visionRaw,
        visionInterpretation: null,
        audioTranscript: null
      }
    });
    const createdAt = this.deps.now();

    this.deps.db.saveMediaArtifact({
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
      expiresAt: addDaysIso(createdAt, this.deps.env.mediaArtifactRetentionDays)
    });

    return result.text;
  }

  private async transcribeDownloadedMedia(
    media: MediaMessageSnapshot,
    filePath: string
  ): Promise<{
    provider: 'gladia';
    providerModel: string;
    artifact: NormalizedMediaArtifact;
    rawResponse: unknown;
    sourceDurationSeconds: number | null;
  }> {
    if (!this.deps.speechToTextProvider) {
      throw new Error('Speech-to-text provider is not configured.');
    }

    return this.deps.speechToTextProvider.transcribe({
      filePath,
      filename: createMediaFilename(media),
      mimeType: media.mimeType ?? 'application/octet-stream',
      timeoutMs: this.deps.env.llmTimeoutMs
    });
  }

  private async describeDownloadedImage(filePath: string): Promise<{
    provider: 'cloudflare';
    providerModel: string;
    rawText: string;
    rawResponse: unknown;
    sourceDurationSeconds: null;
  }> {
    if (!this.deps.visionProvider) {
      throw new Error('Vision provider is not configured.');
    }

    const result = await this.deps.visionProvider.describe({
      filePath,
      timeoutMs: this.deps.env.llmTimeoutMs
    });

    return {
      ...result,
      sourceDurationSeconds: null
    };
  }

  private async buildLookupContext(input: {
    intent: AssistantIntent;
    replyContext: ReplyContext;
    logger: AppLogger;
  }): Promise<LookupContext | null> {
    if (input.intent === 'summarize' || input.intent === 'read') {
      return null;
    }

    const lookupIntent: LookupIntent = input.intent;

    if (!this.deps.env.lookupEnabled || !this.deps.lookupProvider) {
      return null;
    }

    let plan: LookupPlanResult;

    try {
      plan = await this.deps.qwen.planLookup({
        intent: lookupIntent,
        replyContext: input.replyContext
      });
    } catch (error) {
      input.logger.warn('lookup_planner_failed', {
        intent: input.intent,
        ...serializeError(error)
      });

      return createLookupContext({
        status: 'failed',
        intent: lookupIntent,
        decision: createFailedLookupDecision('Lookup planner failed.'),
        errorMessage: error instanceof Error ? error.message : String(error)
      });
    }

    const decision = plan.decision;

    if (plan.status === 'failed') {
      return createLookupContext({
        status: 'failed',
        intent: lookupIntent,
        decision,
        errorMessage: decision.reason
      });
    }

    input.logger.debug('lookup_planner_completed', {
      intent: input.intent,
      shouldLookup: decision.shouldLookup,
      purpose: decision.purpose,
      confidence: decision.confidence,
      queryCount: decision.queries.length,
      plannerModel: plan.model,
      plannerLatencyMs: plan.latencyMs
    });

    if (!decision.shouldLookup) {
      return createLookupContext({
        status: 'skipped',
        intent: lookupIntent,
        decision
      });
    }

    const query = decision.queries[0] ?? null;

    if (!query) {
      return createLookupContext({
        status: 'skipped',
        intent: lookupIntent,
        decision
      });
    }

    try {
      const result = await this.deps.lookupProvider.search({
        query,
        maxResults: this.deps.env.lookupMaxResults,
        timeoutMs: this.deps.env.lookupTimeoutMs
      });

      return createLookupContext({
        status: result.sources.length > 0 ? 'used' : 'weak',
        provider: result.provider,
        intent: lookupIntent,
        decision,
        query: result.query,
        sources: result.sources,
        responseTimeMs: result.responseTimeMs,
        usageCredits: result.usageCredits
      });
    } catch (error) {
      input.logger.warn('lookup_provider_failed', {
        intent: input.intent,
        query,
        ...serializeError(error)
      });

      return createLookupContext({
        status: isTimeoutError(error) ? 'timed_out' : 'failed',
        intent: lookupIntent,
        decision,
        query,
        errorMessage: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async withReplyTyping<T>(
    chatId: number,
    operation: () => Promise<T>
  ): Promise<T> {
    return withTypingIndicator(
      {
        chatId,
        minTypingMs: this.deps.env.replyMinTypingMs,
        maxTypingMs: this.deps.env.replyMaxTypingMs,
        refreshMs: this.deps.env.replyTypingRefreshMs,
        random: this.deps.random,
        delay: this.deps.delay,
        sendTyping: this.deps.sendTyping
      },
      operation
    );
  }
}

function withReplySnapshotFallback(
  context: ReplyContext,
  input: {
    intent: AssistantIntent;
    botUserId: number;
    replyToMessageSnapshot: StoredMessage | null;
  }
): ReplyContext {
  if (
    (input.intent !== 'explain' && input.intent !== 'answer') ||
    context.replyAnchorMessage ||
    !input.replyToMessageSnapshot ||
    input.replyToMessageSnapshot.userId === input.botUserId
  ) {
    return context;
  }

  return {
    ...context,
    replyAnchorMessage: input.replyToMessageSnapshot
  };
}

function getContextLimitForIntent(
  env: AppEnv,
  intent: AssistantIntent
): number {
  switch (intent) {
    case 'explain':
      return env.explainContextLimit;
    case 'summarize':
      return env.summarizeContextLimit;
    case 'decide':
      return env.decideContextLimit;
    case 'read':
      return env.readContextLimit;
    case 'answer':
      return env.answerContextLimit;
  }
}

function artifactFromStoredMediaArtifact(input: unknown): {
  artifact: NormalizedMediaArtifact;
  sourceDurationSeconds: number | null;
} | null {
  if (!input || typeof input !== 'object' || !('type' in input)) {
    return null;
  }

  const artifact = input as NormalizedMediaArtifact;

  return {
    artifact,
    sourceDurationSeconds:
      artifact.type === 'transcript' ? artifact.duration : null
  };
}

function buildTranscriptMediaContext(input: {
  media: MediaMessageSnapshot;
  artifact: NormalizedMediaArtifact;
  sourceDurationSeconds: number | null;
}): DescribeMediaContext {
  return {
    sourceCaption: input.media.caption,
    visionRaw: null,
    visionInterpretation: null,
    audioTranscript: {
      transcript: input.artifact.transcript,
      language: input.artifact.language,
      sourceDurationSeconds: input.sourceDurationSeconds
    }
  };
}

function artifactToText(artifact: NormalizedMediaArtifact): string | null {
  return artifact.transcript;
}

function appendMediaSummaryToMessageText(
  text: string,
  summary: string
): string {
  const trimmedSummary = summary.trim();

  if (trimmedSummary.length === 0) {
    return text;
  }

  if (text.trim().length === 0) {
    return `[media] ${trimmedSummary}`;
  }

  return `${text}\n[media] ${trimmedSummary}`;
}

function createMediaFilename(media: MediaMessageSnapshot): string {
  return `${media.mediaKind}-${media.messageId}${getMediaExtension(media)}`;
}

function getMediaExtension(media: MediaMessageSnapshot): string {
  const mime = media.mimeType ?? '';

  if (mime === 'audio/ogg') {
    return '.ogg';
  }

  if (mime === 'audio/mpeg') {
    return '.mp3';
  }

  if (mime === 'video/mp4') {
    return '.mp4';
  }

  if (mime === 'image/png') {
    return '.png';
  }

  if (mime === 'image/webp') {
    return '.webp';
  }

  if (mime === 'image/jpeg' || media.mediaKind === 'photo') {
    return '.jpg';
  }

  return '.bin';
}

function addDaysIso(value: string, days: number): string {
  return new Date(
    new Date(value).getTime() + days * 24 * 60 * 60 * 1000
  ).toISOString();
}

function createLocalReplyResult(text: string): LlmReplyResult {
  return {
    text,
    model: 'local',
    latencyMs: 0,
    attemptCount: 0,
    promptTokensEstimate: 0
  };
}

function createLookupContext(input: {
  status: LookupContext['status'];
  provider?: LookupContext['provider'];
  intent: LookupIntent;
  decision: LookupDecision;
  query?: string | null;
  sources?: LookupContext['sources'];
  responseTimeMs?: number | null;
  usageCredits?: number | null;
  errorMessage?: string | null;
}): LookupContext {
  return {
    status: input.status,
    provider: input.provider ?? null,
    intent: input.intent,
    decision: input.decision,
    query: input.query ?? null,
    sources: input.sources ?? [],
    responseTimeMs: input.responseTimeMs ?? null,
    usageCredits: input.usageCredits ?? null,
    errorMessage: input.errorMessage ?? null
  };
}

function createFailedLookupDecision(reason: string): LookupDecision {
  return {
    shouldLookup: false,
    purpose: 'none',
    reason,
    queries: [],
    confidence: 'low'
  };
}

function isTimeoutError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' || error.name === 'TimeoutError')
  );
}
