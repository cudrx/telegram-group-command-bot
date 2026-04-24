import type { AppLogger, LogFields } from '../logging/logger.js';

export type AdminNotifier = {
  notify(text: string): Promise<void>;
};

export function createAdminNotifier(input: {
  adminChatId: number;
  sendMessage: (input: { chatId: number; text: string }) => Promise<void>;
}): AdminNotifier {
  return {
    async notify(text) {
      try {
        await input.sendMessage({
          chatId: input.adminChatId,
          text: escapeTelegramHtml(text)
        });
      } catch (error) {
        console.warn(
          `admin notification failed: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }
  };
}

function escapeTelegramHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function createNotifyingLogger(
  base: AppLogger,
  notifier: AdminNotifier
): AppLogger {
  return {
    child(bindings) {
      return createNotifyingLogger(base.child(bindings), notifier);
    },
    debug(event, payload) {
      base.debug(event, payload);
    },
    info(event, payload) {
      base.info(event, payload);
    },
    warn(event, payload = {}) {
      base.warn(event, payload);
      void notifier.notify(`WARN: ${event}`);
    },
    error(event, payload = {}) {
      base.error(event, payload);
      void notifier.notify(formatAdminLogMessage('ERROR', event, payload));
    }
  };
}

function formatAdminLogMessage(
  level: 'WARN' | 'ERROR',
  event: string,
  payload: LogFields
): string {
  const message = readErrorMessage(payload);
  return message ? `${level}: ${event}: ${message}` : `${level}: ${event}`;
}

function readErrorMessage(payload: LogFields): string | null {
  const value = payload.errorMessage ?? payload.message;
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}
