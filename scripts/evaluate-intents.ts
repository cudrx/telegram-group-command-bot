import { pathToFileURL } from 'node:url';

import { main } from './evaluate-intents/runner.js';

export { parseEvalEnv } from './evaluate-intents/env.js';
export {
  filterFixtures,
  parseEvalFilters
} from './evaluate-intents/filters.js';
export { createEvalLookupContext } from './evaluate-intents/lookup-context.js';
export { formatMarkdown, printResult } from './evaluate-intents/reporting.js';
export {
  evaluateRubric,
  hasRubricFailures
} from './evaluate-intents/scoring.js';
export type {
  EvalFilters,
  EvalResult,
  RubricResult
} from './evaluate-intents/types.js';
export { main };

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
