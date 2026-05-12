import type { LookupContext, LookupSource } from '../../src/lookup/types.js';
import type { IntentEvalFixture } from '../intent-eval-fixtures.js';

export function createEvalLookupContext(
  fixture: IntentEvalFixture
): LookupContext | null {
  if (
    !fixture.lookupExpectation ||
    fixture.intent === 'summarize' ||
    fixture.intent === 'read' ||
    fixture.intent === 'translate'
  ) {
    return null;
  }

  return {
    status: fixture.lookupExpectation.shouldLookup ? 'used' : 'skipped',
    provider: fixture.lookupExpectation.shouldLookup ? 'tavily' : null,
    intent: fixture.intent,
    decision: {
      shouldLookup: fixture.lookupExpectation.shouldLookup,
      purpose: fixture.lookupExpectation.purpose,
      reason: 'Fixture-provided lookup context for intent eval.',
      queries: fixture.lookupExpectation.includeTerms,
      confidence: fixture.lookupExpectation.shouldLookup ? 'high' : 'low'
    },
    query: fixture.lookupExpectation.includeTerms.join(' '),
    sources: fixture.lookupExpectation.shouldLookup
      ? createEvalLookupSources(fixture.lookupExpectation.includeTerms)
      : [],
    responseTimeMs: null,
    usageCredits: null,
    errorMessage: null
  };
}

function createEvalLookupSources(includeTerms: string[]): LookupSource[] {
  const sources = includeTerms.map<LookupSource>((term) => ({
    title: term,
    url: `https://example.test/intent-eval-lookup/${encodeURIComponent(term)}`,
    content: `${term} is a central named entity in this fixture.`,
    score: 1
  }));

  return [
    ...sources,
    {
      title: includeTerms.join(' / '),
      url: 'https://example.test/intent-eval-lookup',
      content: includeTerms.join('. '),
      score: 1
    }
  ];
}
