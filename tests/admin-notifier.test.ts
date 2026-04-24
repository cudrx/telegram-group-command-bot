import { describe, expect, test, vi } from 'vitest';

import {
  createAdminNotifier,
  createNotifyingLogger
} from '../src/app/admin-notifier.js';

describe('createAdminNotifier', () => {
  test('sends short messages to the admin chat', async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const notifier = createAdminNotifier({
      adminChatId: 42,
      sendMessage
    });

    await notifier.notify('WARN: image_analysis_failed');

    expect(sendMessage).toHaveBeenCalledWith({
      chatId: 42,
      text: 'WARN: image_analysis_failed'
    });
  });

  test('escapes Telegram HTML-sensitive characters', async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const notifier = createAdminNotifier({
      adminChatId: 42,
      sendMessage
    });

    await notifier.notify('ERROR: media_auto_read_failed: 1 < 2 & bad > ok');

    expect(sendMessage).toHaveBeenCalledWith({
      chatId: 42,
      text: 'ERROR: media_auto_read_failed: 1 &lt; 2 &amp; bad &gt; ok'
    });
  });

  test('swallows send failures', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const notifier = createAdminNotifier({
      adminChatId: 42,
      sendMessage: vi.fn().mockRejectedValue(new Error('telegram down'))
    });

    await expect(notifier.notify('ERROR: x')).resolves.toBeUndefined();
    expect(consoleWarn).toHaveBeenCalled();
    consoleWarn.mockRestore();
  });
});

describe('createNotifyingLogger', () => {
  test('duplicates warn and error to admin notifications', async () => {
    const base = {
      child: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };
    base.child.mockReturnValue(base);
    const notify = vi.fn().mockResolvedValue(undefined);
    const logger = createNotifyingLogger(base, { notify });

    logger.debug('debug_event');
    logger.info('info_event');
    logger.warn('warn_event');
    logger.error('error_event', { errorMessage: 'failed' });

    await Promise.resolve();

    expect(notify).toHaveBeenCalledWith('WARN: warn_event');
    expect(notify).toHaveBeenCalledWith('ERROR: error_event: failed');
    expect(notify).toHaveBeenCalledTimes(2);
  });

  test('uses payload message when errorMessage is absent', async () => {
    const base = {
      child: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };
    base.child.mockReturnValue(base);
    const notify = vi.fn().mockResolvedValue(undefined);
    const logger = createNotifyingLogger(base, { notify });

    logger.error('error_event', { message: 'fallback failed' });

    await Promise.resolve();

    expect(notify).toHaveBeenCalledWith('ERROR: error_event: fallback failed');
  });

  test('does not include warn payload details in admin notifications', async () => {
    const base = {
      child: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };
    base.child.mockReturnValue(base);
    const notify = vi.fn().mockResolvedValue(undefined);
    const logger = createNotifyingLogger(base, { notify });

    logger.warn('warn_event', {
      errorMessage: 'hidden failure',
      message: 'hidden message'
    });

    await Promise.resolve();

    expect(notify).toHaveBeenCalledWith('WARN: warn_event');
    expect(notify).toHaveBeenCalledTimes(1);
  });

  test('keeps child loggers notifying', async () => {
    const childBase = {
      child: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };
    childBase.child.mockReturnValue(childBase);
    const base = { ...childBase, child: vi.fn().mockReturnValue(childBase) };
    const notify = vi.fn().mockResolvedValue(undefined);
    const logger = createNotifyingLogger(base, { notify });

    logger.child({ component: 'x' }).warn('child_warn');
    await Promise.resolve();

    expect(notify).toHaveBeenCalledWith('WARN: child_warn');
  });
});
