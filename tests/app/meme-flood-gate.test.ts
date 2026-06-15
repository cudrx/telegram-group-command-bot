import { describe, expect, test } from 'vitest';

import { createMemeFloodGate } from '../../src/app/meme-flood-gate.js';

describe('createMemeFloodGate', () => {
  test('uses injected clock to track remaining retry-after time', () => {
    let nowMs = 1_000;
    const gate = createMemeFloodGate({
      nowMs: () => nowMs
    });

    gate.block(1, 15);
    expect(gate.getRetryAfterSeconds(1)).toBe(15);

    nowMs = 6_000;
    expect(gate.getRetryAfterSeconds(1)).toBe(10);

    nowMs = 16_000;
    expect(gate.getRetryAfterSeconds(1)).toBeNull();
  });
});
