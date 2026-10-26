import { conversationEvalFixtures } from './conversation.js';
import { replyIntentEvalFixtures } from './reply.js';
import { socialEvalCases } from './social.js';
import type { IntentEvalFixture } from './types.js';

export type { IntentEvalFixture, IntentEvalRubric } from './types.js';

export const intentEvalFixtures: IntentEvalFixture[] = [
  ...replyIntentEvalFixtures,
  ...conversationEvalFixtures,
  ...socialEvalCases.map((item) => item.fixture)
];
