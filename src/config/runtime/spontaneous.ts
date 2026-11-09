export const spontaneousConfig = {
  defaults: {
    enabled: false,
    probability: 0.03,
    cooldownSeconds: 900,
    minMessages: 20,
    maxAttemptsPerHour: 3
  },
  corpusLimit: 1000,
  minSamples: 20,
  maxSampleChars: 500,
  contextLimit: 24,
  maxContextMessageChars: 1000,
  maxContextChars: 8000,
  maxTriggerAgeSeconds: 120,
  botQuietSeconds: 60,
  generation: {
    attempts: 40,
    minWords: 3,
    maxWords: 24,
    maxChars: 300
  },
  maxReplyChars: 400
} as const;

export type SpontaneousPolicy = {
  enabled: boolean;
  probability: number;
  cooldownSeconds: number;
  minMessages: number;
  maxAttemptsPerHour: number;
};
