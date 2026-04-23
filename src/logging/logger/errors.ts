import type { LogFields } from './types.js';

export function serializeError(error: unknown): LogFields {
  if (error instanceof Error) {
    const errorWithFields = error as Error & {
      code?: unknown;
      status?: unknown;
    };

    return {
      errorName: error.name,
      errorMessage: error.message,
      ...(typeof errorWithFields.code === 'string'
        ? {
            errorCode: errorWithFields.code
          }
        : {}),
      ...(typeof errorWithFields.status === 'number'
        ? {
            errorStatus: errorWithFields.status
          }
        : {}),
      errorStack: error.stack
    };
  }

  return {
    errorMessage: String(error)
  };
}
