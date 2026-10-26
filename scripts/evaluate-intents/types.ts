export type RubricResult = {
  include: Array<{ group: string[]; passed: boolean }>;
  includeAll: Array<{ term: string; passed: boolean }>;
  matchRegex: Array<{ pattern: string; passed: boolean }>;
  exclude: Array<{ group: string[]; passed: boolean }>;
  notMatchRegex: Array<{ pattern: string; passed: boolean }>;
};

export type EvalResult = {
  id: string;
  intent: string;
  prompt: string;
  response: string;
  rubric: RubricResult;
  evaluation?:
    | {
        category: string;
        length: { actual: number; max: number | null; passed: boolean };
        botContext: {
          requiredIds: number[];
          missingIds: number[];
          passed: boolean;
        };
        semantic: { criteria: string; status: 'pending' | 'passed' | 'failed' };
      }
    | undefined;
  conversation?: {
    mode: string;
    selectedMessageIds: number[];
    contextPrecision: number | null;
    contextRecall: number | null;
    passed: boolean;
    llmCalls: number;
    promptTokensEstimate: number;
    latencyMs: number;
  };
};

export type EvalFilters = {
  ids: Set<string>;
  intents: Set<string>;
};
