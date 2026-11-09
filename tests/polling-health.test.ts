import { Bot } from 'grammy';
import { describe, expect, test } from 'vitest';
import { createPollingHealth } from '../src/health-server.js';

function setup() {
  let now = 0;
  let running = true;
  let response = { ok: true, result: [] as unknown };
  const health = createPollingHealth(
    () => running,
    () => now
  );
  const bot = new Bot('123:test', {
    client: {
      fetch: async () => new Response(JSON.stringify(response))
    }
  });
  bot.api.config.use(health.transformer);

  return {
    bot,
    health,
    advance: (ms: number) => {
      now += ms;
    },
    stop: () => {
      running = false;
    },
    fail: () => {
      response = { ok: false, result: null };
    }
  };
}

describe('polling health', () => {
  test('requires a successful getUpdates, including an empty response', async () => {
    const { bot, health } = setup();
    expect(health.isHealthy()).toBe(false);
    await bot.api.getMe();
    expect(health.isHealthy()).toBe(false);
    await bot.api.getUpdates();
    expect(health.isHealthy()).toBe(true);
  });

  test('allows media processing time, expires stale polling, and recovers', async () => {
    const { bot, health, advance } = setup();
    await bot.api.getUpdates();
    advance(10 * 60_000);
    expect(health.isHealthy()).toBe(true);
    advance(5 * 60_000);
    expect(health.isHealthy()).toBe(false);
    await bot.api.getUpdates();
    expect(health.isHealthy()).toBe(true);
  });

  test('failed polling and unrelated API calls do not refresh health', async () => {
    const { bot, health, advance, fail } = setup();
    await bot.api.getUpdates();
    advance(14 * 60_000);
    await bot.api.getMe();
    fail();
    await expect(bot.api.getUpdates()).rejects.toThrow();
    advance(60_000);
    expect(health.isHealthy()).toBe(false);
  });

  test('becomes unhealthy immediately when polling stops', async () => {
    const { bot, health, stop } = setup();
    await bot.api.getUpdates();
    stop();
    expect(health.isHealthy()).toBe(false);
  });
});
