import type { IntentEvalFixture } from '../intent-eval-fixtures.js';
import type { EvalFilters } from './types.js';

export function parseEvalFilters(args: string[]): EvalFilters {
  const filters: EvalFilters = {
    ids: new Set(),
    intents: new Set()
  };

  for (const arg of args) {
    if (arg.startsWith('--id=')) {
      addCsvValues(filters.ids, arg.slice('--id='.length));
      continue;
    }

    if (arg.startsWith('--intent=')) {
      addCsvValues(filters.intents, arg.slice('--intent='.length));
      continue;
    }

    if (arg.length > 0) {
      filters.ids.add(arg);
    }
  }

  return filters;
}

export function filterFixtures(
  fixtures: IntentEvalFixture[],
  filters: EvalFilters
): IntentEvalFixture[] {
  return fixtures.filter((fixture) => {
    const idMatches = filters.ids.size === 0 || filters.ids.has(fixture.id);
    const intentMatches =
      filters.intents.size === 0 || filters.intents.has(fixture.intent);

    return idMatches && intentMatches;
  });
}

function addCsvValues(target: Set<string>, value: string): void {
  for (const item of value.split(',')) {
    const normalized = item.trim();

    if (normalized.length > 0) {
      target.add(normalized);
    }
  }
}
