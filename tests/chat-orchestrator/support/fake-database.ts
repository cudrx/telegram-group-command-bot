import type {
  BotOutputMode,
  SaveMediaArtifactInput,
  SaveMemePostInput,
  StoredMediaArtifact,
  UpdateChatTtsStateInput
} from '../../../src/database/index.js';
import type {
  ChatState,
  MediaMessageSnapshot,
  NormalizedMessage,
  StoredMessage
} from '../../../src/domain/models.js';

function toStoredMediaArtifact(
  input: SaveMediaArtifactInput
): StoredMediaArtifact {
  return {
    id: 1,
    ...input
  };
}

function findLastMediaArtifact(
  artifacts: SaveMediaArtifactInput[],
  predicate: (artifact: SaveMediaArtifactInput) => boolean
): SaveMediaArtifactInput | null {
  for (let index = artifacts.length - 1; index >= 0; index -= 1) {
    const artifact = artifacts[index];

    if (artifact && predicate(artifact)) {
      return artifact;
    }
  }

  return null;
}

export class FakeDatabaseClient {
  private readonly messages = new Map<number, StoredMessage[]>();
  private readonly chats = new Map<number, ChatState>();
  readonly savedMediaArtifacts: SaveMediaArtifactInput[] = [];
  readonly savedMemePosts: SaveMemePostInput[] = [];

  constructor(input?: { chats?: ChatState[]; messages?: StoredMessage[] }) {
    for (const chat of input?.chats ?? []) {
      this.chats.set(chat.chatId, { ...chat });
    }

    for (const message of input?.messages ?? []) {
      this.insertMessage(message);
    }
  }

  saveIncomingMessage(message: NormalizedMessage): boolean {
    const chat = this.getOrCreateChat(message);

    chat.lastMessageAt = message.createdAt;
    this.chats.set(message.chatId, chat);

    return this.insertMessage({
      chatId: message.chatId,
      messageId: message.messageId,
      mediaGroupId: message.mediaGroupId ?? null,
      userId: message.fromUserId,
      senderDisplayName: message.fromDisplayName,
      text: message.text,
      createdAt: message.createdAt,
      isBot: message.isBot,
      outputMode: 'text',
      replyToMessageId: message.replyToMessageId,
      mediaSnapshot: message.mediaSnapshot
    });
  }

  saveBotMessage(input: {
    chatId: number;
    chatType: string;
    chatTitle: string | null;
    messageId: number;
    text: string;
    createdAt: string;
    userId: number;
    username?: string | null;
    displayName: string;
    replyToMessageId?: number | null;
    outputMode?: BotOutputMode;
    mediaSnapshot?: MediaMessageSnapshot | null;
  }): void {
    const existingChat = this.chats.get(input.chatId);
    const chat: ChatState = {
      chatId: input.chatId,
      chatType: input.chatType as NormalizedMessage['chatType'],
      title: input.chatTitle,
      lastMessageAt: input.createdAt,
      lastBotMessageAt: input.createdAt,
      answerLastOutputMode: existingChat?.answerLastOutputMode ?? null,
      answerEligibleTextSinceVoice:
        existingChat?.answerEligibleTextSinceVoice ?? 3,
      answerEligibleTextStreak: existingChat?.answerEligibleTextStreak ?? 0,
      readLastVoiceAt: existingChat?.readLastVoiceAt ?? null,
      readTtsVoiceCount: existingChat?.readTtsVoiceCount ?? 0
    };

    this.chats.set(input.chatId, chat);
    this.insertMessage({
      chatId: input.chatId,
      messageId: input.messageId,
      mediaGroupId: null,
      userId: input.userId,
      senderDisplayName: input.displayName,
      text: input.text,
      createdAt: input.createdAt,
      isBot: true,
      outputMode: input.outputMode ?? 'text',
      replyToMessageId: input.replyToMessageId ?? null,
      mediaSnapshot: input.mediaSnapshot ?? null
    });
  }

  updateChatTtsState(input: UpdateChatTtsStateInput): void {
    const chat = this.chats.get(input.chatId);

    if (!chat) {
      return;
    }

    this.chats.set(input.chatId, {
      ...chat,
      ...(Object.hasOwn(input, 'answerLastOutputMode')
        ? { answerLastOutputMode: input.answerLastOutputMode ?? null }
        : {}),
      ...(Object.hasOwn(input, 'answerEligibleTextSinceVoice')
        ? { answerEligibleTextSinceVoice: input.answerEligibleTextSinceVoice }
        : {}),
      ...(Object.hasOwn(input, 'answerEligibleTextStreak')
        ? { answerEligibleTextStreak: input.answerEligibleTextStreak }
        : {}),
      ...(Object.hasOwn(input, 'readLastVoiceAt')
        ? { readLastVoiceAt: input.readLastVoiceAt ?? null }
        : {}),
      ...(Object.hasOwn(input, 'readTtsVoiceCount')
        ? { readTtsVoiceCount: input.readTtsVoiceCount }
        : {})
    });
  }

  getChatState(chatId: number): ChatState | null {
    const chat = this.chats.get(chatId);

    return chat ? { ...chat } : null;
  }

  getMessagesBefore(
    chatId: number,
    beforeMessageId: number,
    limit: number
  ): StoredMessage[] {
    return (this.messages.get(chatId) ?? [])
      .filter((message) => message.messageId < beforeMessageId)
      .slice(-limit)
      .map((message) => ({ ...message }));
  }

  getMessagesInRange(input: {
    chatId: number;
    fromInclusive: string;
    toExclusive: string;
  }): StoredMessage[] {
    return (this.messages.get(input.chatId) ?? [])
      .filter((message) => {
        return (
          message.createdAt >= input.fromInclusive &&
          message.createdAt < input.toExclusive
        );
      })
      .map((message) => ({ ...message }));
  }

  getMessageByTelegramMessageId(
    chatId: number,
    messageId: number
  ): StoredMessage | null {
    const message = (this.messages.get(chatId) ?? []).find(
      (candidate) => candidate.messageId === messageId
    );

    return message ? { ...message } : null;
  }

  getMessagesByMediaGroupId(input: {
    chatId: number;
    mediaGroupId: string;
  }): StoredMessage[] {
    return (this.messages.get(input.chatId) ?? [])
      .filter((message) => message.mediaGroupId === input.mediaGroupId)
      .map((message) => ({ ...message }));
  }

  saveMediaArtifact(input: SaveMediaArtifactInput): void {
    this.savedMediaArtifacts.push(input);
  }

  getSuccessfulMediaArtifact(input: {
    fileUniqueId: string | null;
    chatId: number;
    telegramMessageId: number;
    provider: string;
    artifactKind: string;
  }): StoredMediaArtifact | null {
    const byFileUniqueId = input.fileUniqueId
      ? findLastMediaArtifact(this.savedMediaArtifacts, (artifact) => {
          return (
            artifact.fileUniqueId === input.fileUniqueId &&
            artifact.provider === input.provider &&
            artifact.artifactKind === input.artifactKind &&
            artifact.artifactStatus === 'success'
          );
        })
      : null;
    const artifact =
      byFileUniqueId ??
      findLastMediaArtifact(this.savedMediaArtifacts, (candidate) => {
        return (
          candidate.chatId === input.chatId &&
          candidate.telegramMessageId === input.telegramMessageId &&
          candidate.provider === input.provider &&
          candidate.artifactKind === input.artifactKind &&
          candidate.artifactStatus === 'success'
        );
      });

    return artifact ? toStoredMediaArtifact(artifact) : null;
  }

  getLatestMediaArtifact(input: {
    fileUniqueId: string | null;
    chatId: number;
    telegramMessageId: number;
    provider: string;
    artifactKind: string;
  }): StoredMediaArtifact | null {
    const byFileUniqueId = input.fileUniqueId
      ? findLastMediaArtifact(this.savedMediaArtifacts, (artifact) => {
          return (
            artifact.fileUniqueId === input.fileUniqueId &&
            artifact.provider === input.provider &&
            artifact.artifactKind === input.artifactKind
          );
        })
      : null;
    const artifact =
      byFileUniqueId ??
      findLastMediaArtifact(this.savedMediaArtifacts, (candidate) => {
        return (
          candidate.chatId === input.chatId &&
          candidate.telegramMessageId === input.telegramMessageId &&
          candidate.provider === input.provider &&
          candidate.artifactKind === input.artifactKind
        );
      });

    return artifact ? toStoredMediaArtifact(artifact) : null;
  }

  getSuccessfulMediaArtifactsForMessages(input: {
    chatId: number;
    messageIds: number[];
  }): StoredMediaArtifact[] {
    return this.savedMediaArtifacts
      .filter((artifact) => {
        return (
          artifact.chatId === input.chatId &&
          input.messageIds.includes(artifact.telegramMessageId) &&
          artifact.artifactStatus === 'success'
        );
      })
      .map((artifact) => toStoredMediaArtifact(artifact));
  }

  saveMemePost(input: SaveMemePostInput): void {
    const existingIndex = this.savedMemePosts.findIndex(
      (post) =>
        post.chatId === input.chatId && post.redditPostId === input.redditPostId
    );

    if (existingIndex >= 0) {
      this.savedMemePosts[existingIndex] = input;
      return;
    }

    this.savedMemePosts.push(input);
  }

  getRecentMemePostIds(input: {
    chatId: number;
    redditPostIds: string[];
    since: string;
  }): Set<string> {
    return new Set(
      this.savedMemePosts
        .filter(
          (post) =>
            post.chatId === input.chatId &&
            post.sentAt >= input.since &&
            input.redditPostIds.includes(post.redditPostId)
        )
        .map((post) => post.redditPostId)
    );
  }

  private insertMessage(message: StoredMessage): boolean {
    const messages = this.messages.get(message.chatId) ?? [];

    if (messages.some((existing) => existing.messageId === message.messageId)) {
      return false;
    }

    messages.push({ ...message });
    messages.sort((left, right) => left.messageId - right.messageId);
    this.messages.set(message.chatId, messages);

    return true;
  }

  private getOrCreateChat(input: {
    chatId: number;
    chatType: NormalizedMessage['chatType'];
    chatTitle: string | null;
    createdAt: string;
  }): ChatState {
    return (
      this.chats.get(input.chatId) ?? {
        chatId: input.chatId,
        chatType: input.chatType,
        title: input.chatTitle,
        lastMessageAt: input.createdAt,
        lastBotMessageAt: null,
        answerLastOutputMode: null,
        answerEligibleTextSinceVoice: 3,
        answerEligibleTextStreak: 0,
        readLastVoiceAt: null,
        readTtsVoiceCount: 0
      }
    );
  }
}
