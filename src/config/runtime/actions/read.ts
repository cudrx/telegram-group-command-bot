export const readActionConfig = {
  outboundTts: {
    maxChars: 500,
    cooldownMs: 60 * 60 * 1000,
    hourlyVoiceLimit: 3
  }
} as const;
