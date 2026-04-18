import type { AssistantIntent } from "../domain/models.js";

export type LookupPurpose =
  | "none"
  | "entity_grounding"
  | "fact_check"
  | "freshness"
  | "link_extraction";

export type LookupConfidence = "high" | "medium" | "low";

export type LookupDecision = {
  shouldLookup: boolean;
  purpose: LookupPurpose;
  reason: string;
  queries: string[];
  confidence: LookupConfidence;
};

export type LookupSource = {
  title: string;
  url: string;
  content: string;
  score: number | null;
};

export type LookupStatus =
  | "disabled"
  | "skipped"
  | "used"
  | "failed"
  | "timed_out"
  | "weak";

export type LookupContext = {
  status: LookupStatus;
  provider: "tavily" | null;
  intent: Exclude<AssistantIntent, "summarize">;
  decision: LookupDecision;
  query: string | null;
  sources: LookupSource[];
  responseTimeMs: number | null;
  usageCredits: number | null;
  errorMessage: string | null;
};

export type LookupProviderSearchInput = {
  query: string;
  maxResults: number;
  timeoutMs: number;
};

export type LookupProviderSearchResult = {
  provider: "tavily";
  query: string;
  sources: LookupSource[];
  responseTimeMs: number | null;
  usageCredits: number | null;
};

export type LookupProvider = {
  search(input: LookupProviderSearchInput): Promise<LookupProviderSearchResult>;
};
