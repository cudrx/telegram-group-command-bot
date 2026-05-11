export const answerActionConfig = {
  contextLimit: 16,
  outboundTts: {
    maxChars: 250,
    baseProbability: 0.25,
    minEligibleTextGap: 3,
    pityGap: 12
  }
} as const;
