import { describe, expect, test } from 'vitest';
import { shouldRunIdleSummary } from '../../src/domain/idle-summary-policy.js';
import { NOW, msAgo } from '../helpers/time.js';

type ShouldRunIdleSummaryInput = {
  lastMessageAt: string | null;
  lastSummaryAt: string | null;
  unsummarizedMessageCount: number;
  idleThresholdMs: number;
  minMessages: number;
  now: string;
};

describe('idle-summary-policy', () => {
  test('returns true when the chat has been idle long enough and enough messages accumulated', () => {
    const input: ShouldRunIdleSummaryInput = {
      lastMessageAt: msAgo(30 * 60_000),
      lastSummaryAt: null,
      unsummarizedMessageCount: 3,
      idleThresholdMs: 15 * 60_000,
      minMessages: 3,
      now: NOW,
    };

    expect(shouldRunIdleSummary(input)).toBe(true);
  });

  test('returns true exactly at the idle threshold', () => {
    const input: ShouldRunIdleSummaryInput = {
      lastMessageAt: msAgo(15 * 60_000),
      lastSummaryAt: null,
      unsummarizedMessageCount: 3,
      idleThresholdMs: 15 * 60_000,
      minMessages: 3,
      now: NOW,
    };

    expect(shouldRunIdleSummary(input)).toBe(true);
  });

  test('returns false when the chat is not idle yet', () => {
    const input: ShouldRunIdleSummaryInput = {
      lastMessageAt: msAgo(10 * 60_000),
      lastSummaryAt: null,
      unsummarizedMessageCount: 3,
      idleThresholdMs: 15 * 60_000,
      minMessages: 3,
      now: NOW,
    };

    expect(shouldRunIdleSummary(input)).toBe(false);
  });

  test('returns false when there are too few unsummarized messages', () => {
    const input: ShouldRunIdleSummaryInput = {
      lastMessageAt: msAgo(30 * 60_000),
      lastSummaryAt: null,
      unsummarizedMessageCount: 2,
      idleThresholdMs: 15 * 60_000,
      minMessages: 3,
      now: NOW,
    };

    expect(shouldRunIdleSummary(input)).toBe(false);
  });

  test('returns false when a summary has already run after the last message', () => {
    const input: ShouldRunIdleSummaryInput = {
      lastMessageAt: msAgo(30 * 60_000),
      lastSummaryAt: msAgo(5 * 60_000),
      unsummarizedMessageCount: 3,
      idleThresholdMs: 15 * 60_000,
      minMessages: 3,
      now: NOW,
    };

    expect(shouldRunIdleSummary(input)).toBe(false);
  });

  test('returns false when there has never been a message', () => {
    const input: ShouldRunIdleSummaryInput = {
      lastMessageAt: null,
      lastSummaryAt: null,
      unsummarizedMessageCount: 0,
      idleThresholdMs: 15 * 60_000,
      minMessages: 3,
      now: NOW,
    };

    expect(shouldRunIdleSummary(input)).toBe(false);
  });
});
