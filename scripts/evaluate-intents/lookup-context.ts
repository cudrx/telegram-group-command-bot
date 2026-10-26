import type { LookupSource } from '../../src/lookup/types.js';
import type { IntentEvalFixture } from '../intent-eval-fixtures.js';

export function createEvalLookupSources(
  fixture: IntentEvalFixture
): LookupSource[] {
  return fixture.lookupExpectation?.shouldLookup
    ? (fixture.lookupExpectation.sources ?? [])
    : [];
}

export function matchesLookupExpectation(
  fixture: IntentEvalFixture,
  plan: { purpose: string; queries: string[] }
): boolean {
  const expected = fixture.lookupExpectation;
  if (!expected?.shouldLookup) return false;

  return (
    plan.purpose === expected.purpose &&
    expected.includeTerms.every((term) =>
      plan.queries.some((query) =>
        query.toLowerCase().includes(term.toLowerCase())
      )
    ) &&
    (!expected.includeAnyTerms ||
      expected.includeAnyTerms.some((term) =>
        plan.queries.some((query) =>
          query.toLowerCase().includes(term.toLowerCase())
        )
      ))
  );
}
