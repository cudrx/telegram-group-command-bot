# Weekly Recap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an admin-only `/weekly` flow that builds a seven-day recap for the configured Telegram group, ranks important events before the LLM call, and posts the final report back to the group chat.

**Architecture:** Keep `/weekly` separate from ordinary reply-context commands. The command is detected in `private_admin`, then a dedicated weekly service loads a seven-day slice from the configured group chat, enriches candidate messages with cached media summaries, merges and selects notable events, formats a `WeeklyDataset`, and sends the generated report to `TELEGRAM_CHAT_ID`. Reuse existing prompt loading, prompt sanitization, Telegram HTML formatting, database message storage, and notifying logger patterns rather than threading weekly data through `ReplyContext`.

**Tech Stack:** TypeScript, Node.js, better-sqlite3, grammy, Vitest, existing OpenAI-compatible client and prompt registry.

---

## File Map

**Create:**
- `src/app/weekly/index.ts` - weekly orchestration entrypoint
- `src/app/weekly/messages.ts` - seven-day loading, filtering, stats helpers
- `src/app/weekly/media.ts` - cached media artifact lookup and message enrichment
- `src/app/weekly/events.ts` - burst, reply hotspot, reply chain, and media-moment candidate generation
- `src/app/weekly/select.ts` - merge, scoring, day balancing, and final selection
- `src/app/weekly/format.ts` - `WeeklyDataset` prompt formatting
- `src/app/weekly/types.ts` - weekly-specific types
- `src/llm/openai-compatible-client/weekly.ts` - weekly LLM call
- `llm/reply/weekly.md` - weekly output contract
- `tests/weekly/messages.test.ts`
- `tests/weekly/media.test.ts`
- `tests/weekly/events.test.ts`
- `tests/weekly/select.test.ts`
- `tests/weekly/format.test.ts`
- `tests/chat-orchestrator/weekly/command.test.ts`
- `tests/chat-orchestrator/weekly/orchestration.test.ts`
- `tests/openai-compatible-client/weekly.test.ts`
- `scripts/weekly-smoke.ts`

**Modify:**
- `src/domain/models.ts` - add weekly intent/trigger and weekly dataset types only where shared types are needed
- `src/domain/response-policy.ts` - recognize `/weekly` only for `private_admin`
- `src/app/chat-orchestrator/index.ts` - branch weekly jobs away from ordinary reply jobs
- `src/app/chat-orchestrator/types.ts` - extend LLM and dispatcher contracts for weekly mode
- `src/database/messages-read.ts` - add `getMessagesInRange`
- `src/database/messages.ts` - export `getMessagesInRange`
- `src/database/index.ts` - expose `getMessagesInRange`
- `src/llm/prompt-files.ts` - register `weekly`
- `src/llm/openai-compatible-client/index.ts` - expose `generateWeekly`
- `tests/response-policy.test.ts` - add `/weekly` policy coverage
- `tests/prompt-files.test.ts` - add prompt registry coverage
- `tests/chat-orchestrator/support/fake-database.ts` - support range reads and weekly artifacts
- `tests/chat-orchestrator/support/orchestrator.ts` - support weekly-capable LLM/reply dispatcher
- `README.md`
- `docs/architecture.md`
- `docs/development.md`

**Approval Gate Before Implementation:**
- This feature changes bot command behavior and adds a new prompt. Before Task 1 code changes, get explicit user approval required by `agent/modules/bot-behavior.md`.

### Task 1: Lock The Contract And Command Routing

**Files:**
- Modify: `src/domain/models.ts`
- Modify: `src/domain/response-policy.ts`
- Modify: `tests/response-policy.test.ts`

- [ ] **Step 1: Write the failing policy tests for `/weekly`**

```ts
test('returns weekly command intent in private admin mode', () => {
  const trigger = detectDirectTrigger({
    botUserId: 77,
    botUsername: 'fun_bot',
    message: {
      authorizedMode: 'private_admin',
      text: '/weekly',
      entities: [{ type: 'bot_command', offset: 0, length: 7 }],
      replyToUserId: null
    }
  });

  expect(trigger).toEqual({
    kind: 'command',
    intent: 'weekly',
    commandText: '/weekly'
  });
});

test('returns none for /weekly in chat mode', () => {
  const trigger = detectDirectTrigger({
    botUserId: 77,
    botUsername: 'fun_bot',
    message: {
      authorizedMode: 'chat',
      text: '/weekly',
      entities: [{ type: 'bot_command', offset: 0, length: 7 }],
      replyToUserId: null
    }
  });

  expect(trigger).toEqual({ kind: 'none' });
});
```

- [ ] **Step 2: Run the policy tests to verify they fail**

Run: `npm test -- tests/response-policy.test.ts`
Expected: FAIL because `'weekly'` is not part of `AssistantIntent` and `/weekly` is not recognized.

- [ ] **Step 3: Extend shared trigger types for weekly mode**

```ts
export type AssistantIntent =
  | 'summarize'
  | 'decide'
  | 'read'
  | 'answer'
  | 'weekly';
```

```ts
type DecideReplyActionResult =
  | {
      shouldReply: true;
      reason: 'command';
      intent: AssistantIntent;
    }
  | {
      shouldReply: false;
      reason: 'ignore';
    };
```

- [ ] **Step 4: Teach `response-policy` the admin-only `/weekly` rule**

```ts
const CHAT_COMMAND_INTENTS: Record<string, Exclude<AssistantIntent, 'weekly'>> = {
  summarize: 'summarize',
  decide: 'decide',
  answer: 'answer'
};

function detectCommandTrigger(
  input: DetectDirectTriggerInput
): DirectTrigger | null {
  // existing entity parsing...

  const commandName = parsed.commandName.toLowerCase();

  if (commandName === 'weekly') {
    if (input.message.authorizedMode !== 'private_admin') {
      return null;
    }

    return {
      kind: 'command',
      intent: 'weekly',
      commandText
    };
  }

  if (!allowsCommands(input.message.authorizedMode)) {
    return null;
  }

  const intent = CHAT_COMMAND_INTENTS[commandName];
  // existing return path...
}
```

- [ ] **Step 5: Run the policy tests to verify they pass**

Run: `npm test -- tests/response-policy.test.ts`
Expected: PASS with `/weekly` accepted only in `private_admin` and ignored in group chat.

### Task 2: Add Database Range Reads For Weekly Input

**Files:**
- Modify: `src/database/messages-read.ts`
- Modify: `src/database/messages.ts`
- Modify: `src/database/index.ts`
- Create: `tests/weekly/messages.test.ts`
- Modify: `tests/chat-orchestrator/support/fake-database.ts`

- [ ] **Step 1: Write the failing range-read tests**

```ts
test('loads messages in created_at range ordered by telegram message id', () => {
  const db = DatabaseClient.open(':memory:');

  seedMessages(db, [
    { messageId: 10, createdAt: '2026-04-16T09:00:00.000Z' },
    { messageId: 11, createdAt: '2026-04-17T09:00:00.000Z' },
    { messageId: 12, createdAt: '2026-04-24T08:59:59.000Z' },
    { messageId: 13, createdAt: '2026-04-24T09:00:00.000Z' }
  ]);

  expect(
    db.getMessagesInRange({
      chatId: 1,
      fromInclusive: '2026-04-17T00:00:00.000Z',
      toExclusive: '2026-04-24T09:00:00.000Z'
    }).map((message) => message.messageId)
  ).toEqual([11, 12]);
});

test('fake database supports weekly range reads', () => {
  const db = new FakeDatabaseClient();
  seedFakeMessages(db, [
    createIncomingMessage({ messageId: 1, createdAt: '2026-04-20T10:00:00.000Z' }),
    createIncomingMessage({ messageId: 2, createdAt: '2026-04-21T10:00:00.000Z' })
  ]);

  expect(
    db.getMessagesInRange({
      chatId: 1,
      fromInclusive: '2026-04-21T00:00:00.000Z',
      toExclusive: '2026-04-22T00:00:00.000Z'
    })
  ).toHaveLength(1);
});
```

- [ ] **Step 2: Run the weekly message tests to verify they fail**

Run: `npm test -- tests/weekly/messages.test.ts`
Expected: FAIL because `getMessagesInRange` does not exist yet.

- [ ] **Step 3: Implement `getMessagesInRange` in the SQLite reader**

```ts
export function getMessagesInRange(
  db: Database.Database,
  input: {
    chatId: number;
    fromInclusive: string;
    toExclusive: string;
  }
): StoredMessage[] {
  const rows = db
    .prepare(
      `
        SELECT
          chat_id AS chatId,
          telegram_message_id AS messageId,
          user_id AS userId,
          sender_display_name AS senderDisplayName,
          text,
          created_at AS createdAt,
          is_bot AS isBot,
          reply_to_telegram_message_id AS replyToMessageId,
          media_kind AS mediaKind,
          media_file_id AS mediaFileId,
          media_file_unique_id AS mediaFileUniqueId,
          media_mime_type AS mediaMimeType,
          media_file_size AS mediaFileSize,
          media_duration_seconds AS mediaDurationSeconds,
          media_caption AS mediaCaption,
          media_group_id AS mediaGroupId
        FROM messages
        WHERE chat_id = ?
          AND created_at >= ?
          AND created_at < ?
        ORDER BY telegram_message_id ASC
      `
    )
    .all(input.chatId, input.fromInclusive, input.toExclusive) as StoredMessageRow[];

  return rows.map(toStoredMessage);
}
```

- [ ] **Step 4: Export the range reader through the database facade and fake DB**

```ts
export {
  getMessageByTelegramMessageId,
  getMessagesBefore,
  getMessagesInRange,
  getRecentMessages
} from './messages-read.js';
```

```ts
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
```

- [ ] **Step 5: Run the weekly message tests to verify they pass**

Run: `npm test -- tests/weekly/messages.test.ts`
Expected: PASS with deterministic ordering and correct range boundaries.

### Task 3: Build Weekly Message Loading And Media Enrichment

**Files:**
- Create: `src/app/weekly/types.ts`
- Create: `src/app/weekly/messages.ts`
- Create: `src/app/weekly/media.ts`
- Create: `tests/weekly/media.test.ts`
- Modify: `src/app/chat-orchestrator/media/cache.ts`

- [ ] **Step 1: Write the failing enrichment tests**

```ts
test('prefers cached image summaries in the existing order', () => {
  const summary = getWeeklyPreferredMediaSummary(
    [
      createArtifact({ telegramMessageId: 21, artifactKind: 'vision_raw', artifactText: 'raw' }),
      createArtifact({ telegramMessageId: 21, artifactKind: 'ocr_text_ru', artifactText: 'текст' }),
      createArtifact({ telegramMessageId: 21, artifactKind: 'vision_interpretation', artifactText: 'мем про дедлайн' })
    ],
    {
      messageId: 21,
      mediaSnapshot: { mediaKind: 'photo' } as never,
      text: '',
      isBot: false
    }
  );

  expect(summary).toBe('мем про дедлайн');
});

test('renders media kind and caption when no artifact exists', () => {
  expect(
    formatWeeklyMessageLine({
      createdAt: '2026-04-24T18:12:00.000Z',
      senderDisplayName: 'Tom',
      text: '',
      mediaSnapshot: { mediaKind: 'voice', caption: 'срочно послушайте' } as never
    } as never)
  ).toContain('[voice] срочно послушайте');
});
```

- [ ] **Step 2: Run the media tests to verify they fail**

Run: `npm test -- tests/weekly/media.test.ts`
Expected: FAIL because weekly media helpers do not exist yet.

- [ ] **Step 3: Extract or wrap the existing preferred media summary logic for weekly reuse**

```ts
export function getPreferredMediaSummary(
  artifacts: StoredMediaArtifact[],
  messageId: number,
  mediaKind: MediaMessageSnapshot['mediaKind']
): string | null {
  // existing ordered selection logic stays shared here
}

export function getWeeklyPreferredMediaSummary(
  artifacts: StoredMediaArtifact[],
  message: Pick<StoredMessage, 'messageId' | 'mediaSnapshot'>
): string | null {
  if (!message.mediaSnapshot) {
    return null;
  }

  return getPreferredMediaSummary(
    artifacts,
    message.messageId,
    message.mediaSnapshot.mediaKind
  );
}
```

- [ ] **Step 4: Implement weekly message loading, filtering, and enrichment**

```ts
export type WeeklyMessage = StoredMessage & {
  mediaSummary: string | null;
};

export function loadWeeklyMessages(input: {
  db: Pick<DatabaseClient, 'getMessagesInRange'>;
  chatId: number;
  now: string;
}): WeeklyMessage[] {
  const toExclusive = input.now;
  const fromInclusive = new Date(
    Date.parse(input.now) - 7 * 24 * 60 * 60 * 1000
  ).toISOString();

  return input.db
    .getMessagesInRange({
      chatId: input.chatId,
      fromInclusive,
      toExclusive
    })
    .filter((message) => !message.isBot)
    .map((message) => ({
      ...message,
      mediaSummary: null
    }));
}
```

```ts
export function enrichWeeklyMessagesWithMedia(input: {
  db: Pick<DatabaseClient, 'getSuccessfulMediaArtifactsForMessages'>;
  messages: WeeklyMessage[];
}): WeeklyMessage[] {
  const messageIds = input.messages.map((message) => message.messageId);
  const chatId = input.messages[0]?.chatId;

  if (!chatId || messageIds.length === 0) {
    return input.messages;
  }

  const artifacts = input.db.getSuccessfulMediaArtifactsForMessages({
    chatId,
    messageIds
  });

  return input.messages.map((message) => ({
    ...message,
    mediaSummary: getWeeklyPreferredMediaSummary(artifacts, message)
  }));
}
```

- [ ] **Step 5: Add compact weekly stats helpers**

```ts
export function buildWeeklyStats(messages: WeeklyMessage[]) {
  const byDay = new Map<string, number>();

  for (const message of messages) {
    const day = message.createdAt.slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }

  return {
    totalHumanMessages: messages.length,
    participants: new Set(messages.map((message) => message.userId).filter(Boolean)).size,
    replyMessages: messages.filter((message) => message.replyToMessageId !== null).length,
    mediaMessages: messages.filter((message) => message.mediaSnapshot).length,
    mediaMessagesWithSuccessfulSummaries: messages.filter((message) => message.mediaSummary).length,
    topActiveDays: [...byDay.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
  };
}
```

- [ ] **Step 6: Run the message and media tests to verify they pass**

Run: `npm test -- tests/weekly/messages.test.ts tests/weekly/media.test.ts`
Expected: PASS with bot messages filtered out and cached media summaries preferred over fallback captions.

### Task 4: Implement Candidate Detection

**Files:**
- Create: `src/app/weekly/events.ts`
- Modify: `src/app/weekly/types.ts`
- Create: `tests/weekly/events.test.ts`

- [ ] **Step 1: Write the failing event-detection tests**

```ts
test('detects burst windows and expands to natural boundaries', () => {
  const candidates = buildWeeklyCandidates(
    createWeeklyMessagesForBurst({
      startAt: '2026-04-22T18:10:00.000Z',
      count: 12,
      spacingMinutes: 0.5,
      participants: [10, 11, 12]
    })
  );

  expect(candidates).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kinds: expect.arrayContaining(['burst']),
        messageIds: expect.arrayContaining([101, 112])
      })
    ])
  );
});

test('detects reply hotspots, reply chains, and media moments', () => {
  const candidates = buildWeeklyCandidates(createMixedWeeklyMessages());

  expect(candidates.some((candidate) => candidate.kinds.includes('reply_hotspot'))).toBe(true);
  expect(candidates.some((candidate) => candidate.kinds.includes('reply_chain'))).toBe(true);
  expect(candidates.some((candidate) => candidate.kinds.includes('media_moment'))).toBe(true);
});
```

- [ ] **Step 2: Run the event tests to verify they fail**

Run: `npm test -- tests/weekly/events.test.ts`
Expected: FAIL because `buildWeeklyCandidates` and weekly event types do not exist yet.

- [ ] **Step 3: Define the weekly candidate types**

```ts
export type WeeklyEventKind =
  | 'burst'
  | 'reply_hotspot'
  | 'reply_chain'
  | 'media_moment';

export type WeeklyEventCandidate = {
  id: string;
  kinds: WeeklyEventKind[];
  startAt: string;
  endAt: string;
  messageIds: number[];
  participantIds: number[];
  score: number;
  reasons: string[];
};
```

- [ ] **Step 4: Implement the four candidate detectors**

```ts
export function buildWeeklyCandidates(messages: WeeklyMessage[]): WeeklyEventCandidate[] {
  return [
    ...detectBursts(messages),
    ...detectReplyHotspots(messages),
    ...detectReplyChains(messages),
    ...detectMediaMoments(messages)
  ];
}
```

```ts
function detectBursts(messages: WeeklyMessage[]): WeeklyEventCandidate[] {
  // sliding 10 minute window, minimum 12 messages, minimum 2 participants,
  // then expand while neighbor gap <= 5 minutes
}

function detectReplyHotspots(messages: WeeklyMessage[]): WeeklyEventCandidate[] {
  // anchor + direct replies + ~5 nearby messages on each side
}

function detectReplyChains(messages: WeeklyMessage[]): WeeklyEventCandidate[] {
  // connected components over reply_to_telegram_message_id
}

function detectMediaMoments(messages: WeeklyMessage[]): WeeklyEventCandidate[] {
  // require mediaSummary and either replies or dense nearby activity
}
```

- [ ] **Step 5: Add deterministic scoring inputs on each candidate**

```ts
function scoreCandidate(input: {
  messageCount: number;
  participantCount: number;
  replyCount: number;
  maxRepliesToOneMessage: number;
  mediaSummaryCount: number;
}): number {
  return (
    input.messageCount +
    input.participantCount * 3 +
    input.replyCount * 2 +
    input.maxRepliesToOneMessage * 4 +
    input.mediaSummaryCount * 3
  );
}
```

- [ ] **Step 6: Run the event tests to verify they pass**

Run: `npm test -- tests/weekly/events.test.ts`
Expected: PASS with explicit coverage for bursts, reply hotspots, reply chains, and media moments.

### Task 5: Merge, Balance, And Format Weekly Evidence

**Files:**
- Create: `src/app/weekly/select.ts`
- Create: `src/app/weekly/format.ts`
- Create: `tests/weekly/select.test.ts`
- Create: `tests/weekly/format.test.ts`
- Modify: `src/llm/prompts.ts`
- Modify: `src/llm/prompt-files.ts`

- [ ] **Step 1: Write the failing selection and formatting tests**

```ts
test('merges overlapping candidates and keeps all kinds', () => {
  const merged = mergeWeeklyCandidates([
    createCandidate({ id: 'a', kinds: ['burst'], messageIds: [1, 2, 3], participantIds: [10, 11] }),
    createCandidate({ id: 'b', kinds: ['reply_hotspot'], messageIds: [3, 4], participantIds: [11, 12] })
  ]);

  expect(merged).toEqual([
    expect.objectContaining({
      kinds: expect.arrayContaining(['burst', 'reply_hotspot']),
      messageIds: [1, 2, 3, 4]
    })
  ]);
});

test('selects 6 to 10 events with a soft two-per-day cap', () => {
  const selected = selectWeeklyEvents(createRankedCandidatesAcrossDays());

  expect(selected.length).toBeGreaterThanOrEqual(6);
  expect(selected.length).toBeLessThanOrEqual(10);
  expect(maxEventsPerDay(selected)).toBeLessThanOrEqual(2);
});

test('formats prompt-safe weekly dataset with sanitized message lines', () => {
  const dataset = formatWeeklyDataset(createWeeklyDatasetFixture());

  expect(dataset).toContain('WEEK_STATS');
  expect(dataset).toContain('SELECTED_EVENTS');
  expect(dataset).toContain('&quot;');
});
```

- [ ] **Step 2: Run the select and format tests to verify they fail**

Run: `npm test -- tests/weekly/select.test.ts tests/weekly/format.test.ts`
Expected: FAIL because merge/selection/formatting helpers do not exist yet.

- [ ] **Step 3: Implement merge and day-balanced selection**

```ts
export function mergeWeeklyCandidates(
  candidates: WeeklyEventCandidate[]
): WeeklyEventCandidate[] {
  // merge when message ids overlap, time windows overlap,
  // or gap < 5 minutes with shared participants
}

export function selectWeeklyEvents(
  candidates: WeeklyEventCandidate[]
): WeeklyEventCandidate[] {
  const merged = mergeWeeklyCandidates(candidates).sort(
    (left, right) => right.score - left.score
  );

  const selected: WeeklyEventCandidate[] = [];
  const perDay = new Map<string, number>();

  for (const candidate of merged) {
    const day = candidate.startAt.slice(0, 10);
    if ((perDay.get(day) ?? 0) >= 2) {
      continue;
    }

    selected.push(candidate);
    perDay.set(day, (perDay.get(day) ?? 0) + 1);

    if (selected.length === 10) {
      break;
    }
  }

  if (selected.length < 6) {
    for (const candidate of merged) {
      if (selected.some((existing) => existing.id === candidate.id)) {
        continue;
      }

      selected.push(candidate);

      if (selected.length === 6 || selected.length === 10) {
        break;
      }
    }
  }

  return selected;
}
```

- [ ] **Step 4: Implement prompt-safe weekly dataset formatting**

```ts
import { sanitizePromptText } from '../../llm/prompts/sanitize.js';

export function formatWeeklyDataset(input: WeeklyDataset): string {
  return [
    'WEEK_STATS',
    `- period: ${input.period.fromInclusive}..${input.period.toExclusive}`,
    `- total human messages: ${input.stats.totalHumanMessages}`,
    '',
    'PARTICIPANT_STATS',
    ...input.participants.map((participant) =>
      `- ${sanitizePromptText(participant.displayName)}: messages=${participant.messageCount}, replies_sent=${participant.repliesSent}, replies_received=${participant.repliesReceived}, media_sent=${participant.mediaSent}`
    ),
    '',
    'SELECTED_EVENTS',
    ...input.events.map(formatWeeklyEvent)
  ].join('\n');
}
```

```ts
function formatWeeklyEvent(event: WeeklyDatasetEvent): string {
  return [
    `[EVENT ${event.index}]`,
    `kinds: ${event.kinds.join(', ')}`,
    `time: ${event.startAt}..${event.endAt}`,
    `score: ${event.score}`,
    'messages:',
    ...event.messages.map((message) => `- ${sanitizePromptText(message)}`),
    ''
  ].join('\n');
}
```

- [ ] **Step 5: Register the weekly prompt file**

```ts
export const PROMPT_FILE_PATHS = {
  base: 'llm/assistant/base.md',
  global: 'llm/reply/global.md',
  replyShell: 'llm/reply/shell.md',
  summarize: 'llm/reply/summarize.md',
  decide: 'llm/reply/decide.md',
  read: 'llm/reply/read.md',
  answer: 'llm/reply/answer.md',
  weekly: 'llm/reply/weekly.md',
  // existing entries...
} as const;
```

- [ ] **Step 6: Run the selection, formatting, and prompt registry tests**

Run: `npm test -- tests/weekly/select.test.ts tests/weekly/format.test.ts tests/prompt-files.test.ts`
Expected: PASS with weekly prompt registered and weekly dataset formatted with sanitized text.

### Task 6: Add Weekly LLM Generation And Orchestrator Branching

**Files:**
- Create: `src/llm/openai-compatible-client/weekly.ts`
- Modify: `src/llm/openai-compatible-client/index.ts`
- Create: `llm/reply/weekly.md`
- Create: `tests/openai-compatible-client/weekly.test.ts`
- Modify: `src/app/chat-orchestrator/types.ts`
- Modify: `src/app/chat-orchestrator/index.ts`
- Create: `src/app/weekly/index.ts`
- Create: `tests/chat-orchestrator/weekly/command.test.ts`
- Create: `tests/chat-orchestrator/weekly/orchestration.test.ts`
- Modify: `tests/chat-orchestrator/support/orchestrator.ts`

- [ ] **Step 1: Write the failing weekly LLM and orchestration tests**

```ts
test('uses the reply model and weekly prompt contract for weekly reports', async () => {
  const client = new OpenAiCompatibleLlmClient(createClientConfig(), createOpenAiStub('<b>Неделя в чате</b>'));

  await client.generateWeekly({
    assistantInstructions: loadPrompt('base'),
    weeklyDataset: 'WEEK_STATS\n- total human messages: 42'
  });

  expect(lastRequestBody?.model).toBe('reply-model');
  expect(JSON.stringify(lastRequestBody)).toContain('Неделя в чате');
  expect(JSON.stringify(lastRequestBody)).toContain('SELECTED_EVENTS');
});
```

```ts
test('runs /weekly from private admin without sending a private confirmation', async () => {
  const db = new FakeDatabaseClient();
  seedGroupWeek(db);
  const generateWeekly = vi.fn().mockResolvedValue(createReplyResult('<b>Неделя в чате</b>\n• живо'));
  const replyDispatcher = vi.fn();
  const weeklyDispatcher = vi.fn().mockResolvedValue({
    messageId: 1001,
    createdAt: '2026-04-24T09:00:30.000Z'
  });
  const orchestrator = createOrchestrator({
    db,
    qwen: { generateReply: vi.fn(), generateWeekly },
    replyDispatcher,
    weeklyDispatcher
  });

  await orchestrator.handleIncomingMessage(
    createIncomingMessage({
      chatId: 99,
      chatType: 'private',
      authorizedMode: 'private_admin',
      text: '/weekly',
      entities: [{ type: 'bot_command', offset: 0, length: 7 }]
    })
  );

  expect(generateWeekly).toHaveBeenCalled();
  expect(replyDispatcher).not.toHaveBeenCalled();
  expect(weeklyDispatcher).toHaveBeenCalledWith({
    chatId: 1,
    text: '<b>Неделя в чате</b>\n• живо'
  });
});
```

- [ ] **Step 2: Run the weekly LLM and orchestrator tests to verify they fail**

Run: `npm test -- tests/openai-compatible-client/weekly.test.ts tests/chat-orchestrator/weekly/command.test.ts tests/chat-orchestrator/weekly/orchestration.test.ts`
Expected: FAIL because `generateWeekly`, `weeklyDispatcher`, and weekly orchestration do not exist yet.

- [ ] **Step 3: Add the weekly LLM path**

```ts
export async function generateWeekly(params: {
  config: LlmClientConfig;
  createCompletion: ChatCompletionsCreate;
  options: LlmClientOptions;
  input: {
    assistantInstructions: string;
    weeklyDataset: string;
  };
}): Promise<LlmReplyResult> {
  const prompt = renderPromptTemplate(loadPrompt('replyShell'), {
    assistantInstructions: params.input.assistantInstructions,
    globalPrompt: loadPrompt('global'),
    targetDisplayName: 'weekly-report',
    intent: 'weekly',
    intentPrompt: loadPrompt('weekly'),
    dataSections: params.input.weeklyDataset,
    lookupSections: ''
  });

  // same completion/retry/logging pattern as generateReply
}
```

```ts
async generateWeekly(input: {
  assistantInstructions: string;
  weeklyDataset: string;
}): Promise<LlmReplyResult> {
  return generateWeekly({
    config: this.config,
    createCompletion: this.createCompletion,
    options: this.options,
    input
  });
}
```

- [ ] **Step 4: Add weekly-specific orchestrator dependencies and service orchestration**

```ts
export type WeeklyDispatcher = (input: {
  chatId: number;
  text: string;
}) => Promise<SentBotMessage>;
```

```ts
if (decision.intent === 'weekly') {
  await this.runWeeklyJob(
    {
      triggerChatId: message.chatId,
      triggerMessageId: message.messageId
    },
    logger
  );
  return;
}
```

```ts
export class WeeklyService {
  async generateAndSend(): Promise<void> {
    const messages = loadWeeklyMessages({
      db: this.deps.db,
      chatId: this.deps.env.telegramChatId,
      now: this.deps.now()
    });
    const enriched = enrichWeeklyMessagesWithMedia({
      db: this.deps.db,
      messages
    });
    const candidates = buildWeeklyCandidates(enriched);
    const selected = selectWeeklyEvents(candidates);
    const weeklyDataset = formatWeeklyDataset(
      buildWeeklyDataset({
        now: this.deps.now(),
        messages: enriched,
        selected
      })
    );
    const result = await this.deps.qwen.generateWeekly({
      assistantInstructions: loadPrompt('base'),
      weeklyDataset
    });
    const sent = await this.deps.weeklyDispatcher({
      chatId: this.deps.env.telegramChatId,
      text: formatTelegramHtmlReply(result.text)
    });
    this.deps.db.saveBotMessage({
      chatId: this.deps.env.telegramChatId,
      chatType: 'group',
      chatTitle: null,
      messageId: sent.messageId,
      text: formatTelegramHtmlReply(result.text),
      createdAt: sent.createdAt,
      userId: this.deps.bot.userId,
      username: this.deps.bot.username,
      displayName: this.deps.bot.displayName
    });
  }
}
```

- [ ] **Step 5: Write the weekly prompt contract**

```md
<b>Неделя в чате</b>

• 2-3 bullets with the main arc of the week.

<b>Темы</b>

• Use only themes supported by SELECTED_EVENTS.

<b>Моменты</b>

• Highlight concrete moments, not generic mood summaries.

<b>Роли недели</b>

• Describe only roles visible this week.

<b>Факты</b>

• Mention concrete evidence-backed facts.

<b>Итог</b>
One short closing paragraph.
```

- [ ] **Step 6: Run the weekly LLM and orchestration tests to verify they pass**

Run: `npm test -- tests/openai-compatible-client/weekly.test.ts tests/chat-orchestrator/weekly/command.test.ts tests/chat-orchestrator/weekly/orchestration.test.ts`
Expected: PASS with `/weekly` handled only in private admin, no private confirmation sent, and the recap posted to the configured group chat.

### Task 7: Add Smoke Tooling And Finish Documentation

**Files:**
- Create: `scripts/weekly-smoke.ts`
- Modify: `README.md`
- Modify: `docs/architecture.md`
- Modify: `docs/development.md`

- [ ] **Step 1: Write the failing smoke-path test or dry-run assertion**

```ts
test('weekly smoke path builds stats and events without Telegram network calls', async () => {
  const output = await runWeeklySmoke({
    sqlitePath: 'data/prod-smoke.sqlite',
    now: '2026-04-24T09:00:00.000Z'
  });

  expect(output).toContain('WEEK_STATS');
  expect(output).toContain('SELECTED_EVENTS');
});
```

- [ ] **Step 2: Implement the local smoke script**

```ts
const db = DatabaseClient.open(process.env.SQLITE_PATH ?? 'data/prod-smoke.sqlite');
const service = createWeeklyPreviewService({
  db,
  chatId: Number(process.env.TELEGRAM_CHAT_ID),
  now: process.env.WEEKLY_NOW ?? new Date().toISOString()
});

const preview = service.buildPreview();
console.log(preview.dataset);
```

- [ ] **Step 3: Document the command and architecture changes**

```md
- `/weekly` works only in the admin private chat.
- It reads the last seven days from `TELEGRAM_CHAT_ID`.
- It never triggers new media recognition work.
- It posts the final recap into the configured group chat.
```

- [ ] **Step 4: Run focused verification and then the full suite**

Run: `npm test -- tests/weekly/messages.test.ts tests/weekly/media.test.ts tests/weekly/events.test.ts tests/weekly/select.test.ts tests/weekly/format.test.ts tests/chat-orchestrator/weekly/command.test.ts tests/chat-orchestrator/weekly/orchestration.test.ts tests/openai-compatible-client/weekly.test.ts tests/response-policy.test.ts tests/prompt-files.test.ts`
Expected: PASS for all weekly-focused coverage.

Run: `npm test`
Expected: PASS for the full Vitest suite.

Run: `npm run typecheck`
Expected: PASS with weekly intent and new service types accepted across the project.

## Notes For The Implementer

- Keep weekly data flow out of `ReplyContext`; use weekly-specific types end-to-end.
- Reuse the existing preferred media artifact ordering from `src/app/chat-orchestrator/media/cache.ts`.
- Sanitize all user-originated text before adding it to an LLM prompt.
- Use UTC calendar days exactly as specified in the design.
- Do not send any success acknowledgment to the admin private chat.
- On LLM failure or Telegram send failure, log and exit without posting a group message.

## Self-Review

- Spec coverage: command policy, range loading, cached media summaries, event detection, merge/dedupe, day-balanced selection, prompt contract, orchestration, smoke tooling, and docs are all mapped to explicit tasks.
- Placeholder scan: removed vague “handle later” language; every task points to exact files, commands, and concrete code shapes.
- Type consistency: `weekly` is introduced once as an intent, weekly data stays in `Weekly*` types, and the LLM contract uses `generateWeekly` consistently.

Plan complete and saved to `docs/superpowers/plans/2026-04-24-weekly-design.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
