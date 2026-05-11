import type Database from 'better-sqlite3';

import { answerActionConfig } from '../config/runtime/index.js';
import type { BotOutputMode, ChatState } from '../domain/models.js';
import type { UpdateChatTtsStateInput } from './types.js';

type ChatStateRow = Omit<
  ChatState,
  | 'answerLastOutputMode'
  | 'answerEligibleTextSinceVoice'
  | 'answerEligibleTextStreak'
  | 'readLastVoiceAt'
  | 'readTtsVoiceCount'
> & {
  answerLastOutputMode?: string | null;
  answerEligibleTextSinceVoice?: number | null;
  answerEligibleTextStreak?: number | null;
  readLastVoiceAt?: string | null;
  readTtsVoiceCount?: number | null;
};

export function getChatState(
  db: Database.Database,
  chatId: number
): ChatState | null {
  const row = db
    .prepare(
      `
        SELECT
          chat_id AS chatId,
          chat_type AS chatType,
          title,
          last_message_at AS lastMessageAt,
          last_bot_message_at AS lastBotMessageAt,
          answer_last_output_mode AS answerLastOutputMode,
          answer_eligible_text_since_voice AS answerEligibleTextSinceVoice,
          answer_eligible_text_streak AS answerEligibleTextStreak,
          read_last_voice_at AS readLastVoiceAt,
          read_tts_voice_count AS readTtsVoiceCount
        FROM chats
        WHERE chat_id = ?
      `
    )
    .get(chatId) as ChatStateRow | undefined;

  return row ? toChatState(row) : null;
}

export function upsertChat(
  db: Database.Database,
  input: {
    chatId: number;
    chatType: string;
    title: string | null;
    lastMessageAt: string;
    lastBotMessageAt: string | null;
  }
): void {
  db.prepare(
    `
      INSERT INTO chats (chat_id, chat_type, title, last_message_at, last_bot_message_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(chat_id) DO UPDATE SET
        chat_type = excluded.chat_type,
        title = excluded.title,
        last_message_at = excluded.last_message_at,
        last_bot_message_at = COALESCE(excluded.last_bot_message_at, chats.last_bot_message_at)
    `
  ).run(
    input.chatId,
    input.chatType,
    input.title,
    input.lastMessageAt,
    input.lastBotMessageAt
  );
}

export function updateChatTtsState(
  db: Database.Database,
  input: UpdateChatTtsStateInput
): void {
  const assignments: string[] = [];
  const values: Array<string | number | null> = [];

  addAssignment(
    input,
    'answerLastOutputMode',
    'answer_last_output_mode',
    assignments,
    values
  );
  addAssignment(
    input,
    'answerEligibleTextSinceVoice',
    'answer_eligible_text_since_voice',
    assignments,
    values
  );
  addAssignment(
    input,
    'answerEligibleTextStreak',
    'answer_eligible_text_streak',
    assignments,
    values
  );
  addAssignment(
    input,
    'readLastVoiceAt',
    'read_last_voice_at',
    assignments,
    values
  );
  addAssignment(
    input,
    'readTtsVoiceCount',
    'read_tts_voice_count',
    assignments,
    values
  );

  if (assignments.length === 0) {
    return;
  }

  db.prepare(
    `
      UPDATE chats
      SET ${assignments.join(', ')}
      WHERE chat_id = ?
    `
  ).run(...values, input.chatId);
}

function addAssignment<K extends keyof UpdateChatTtsStateInput>(
  input: UpdateChatTtsStateInput,
  property: K,
  columnName: string,
  assignments: string[],
  values: Array<string | number | null>
): void {
  if (!Object.hasOwn(input, property)) {
    return;
  }

  assignments.push(`${columnName} = ?`);
  values.push(input[property] as string | number | null);
}

function toChatState(row: ChatStateRow): ChatState {
  return {
    ...row,
    answerLastOutputMode: toBotOutputMode(row.answerLastOutputMode),
    answerEligibleTextSinceVoice:
      row.answerEligibleTextSinceVoice ??
      answerActionConfig.outboundTts.minEligibleTextGap,
    answerEligibleTextStreak: row.answerEligibleTextStreak ?? 0,
    readLastVoiceAt: row.readLastVoiceAt ?? null,
    readTtsVoiceCount: row.readTtsVoiceCount ?? 0
  };
}

function toBotOutputMode(
  value: string | null | undefined
): BotOutputMode | null {
  if (value === 'text' || value === 'voice') {
    return value;
  }

  return null;
}
