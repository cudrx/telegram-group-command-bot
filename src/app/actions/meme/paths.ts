import path from 'node:path';

export function resolveRuntimeFilePath(filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.resolve(filePath);
}
