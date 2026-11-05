export const answerActionConfig = {
  contextLimit: 80,
  validationRetries: 1,
  clarificationMaxChars: 240,
  context: {
    scanLimit: 128,
    anchorNeighborLimit: 16,
    maxReplyDepth: 16,
    maxReplyRoots: 8,
    scoring: {
      lexicalMatch: 20,
      sameAuthor: 10,
      anchorNeighbor: 500,
      replyAncestor: 600,
      targetAncestor: 10_000
    },
    maxSelectedMessages: 64,
    maxDiscussions: 16,
    maxInferredLinks: 128,
    candidateTokenBudget: 8_000,
    maxPromptTokens: 16_000,
    maxMessageChars: 6_000
  },
  outboundTts: {
    maxChars: 250,
    baseProbability: 0.25,
    minEligibleTextGap: 3,
    pityGap: 12
  }
} as const;
