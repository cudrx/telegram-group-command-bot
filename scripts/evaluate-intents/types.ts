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
};

export type EvalFilters = {
  ids: Set<string>;
  intents: Set<string>;
};
