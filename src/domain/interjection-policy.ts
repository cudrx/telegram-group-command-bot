export type InterjectionPolicyInput = {
  probability: number;
  randomValue: number;
  cooldownMs: number;
  lastBotMessageAt: string | null;
  now: string;
};

export function shouldInterject(input: InterjectionPolicyInput): boolean {
  const probability = clampProbability(input.probability);

  if (probability <= 0) {
    return false;
  }

  if (input.randomValue >= probability) {
    return false;
  }

  if (input.lastBotMessageAt === null) {
    return true;
  }

  const now = Date.parse(input.now);
  const lastBotMessageAt = Date.parse(input.lastBotMessageAt);

  if (Number.isNaN(now) || Number.isNaN(lastBotMessageAt)) {
    return false;
  }

  return now - lastBotMessageAt >= input.cooldownMs;
}

function clampProbability(value: number): number {
  if (Number.isNaN(value)) {
    return 0;
  }

  if (value < 0) {
    return 0;
  }

  if (value > 1) {
    return 1;
  }

  return value;
}
