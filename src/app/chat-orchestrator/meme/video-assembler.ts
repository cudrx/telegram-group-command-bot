export async function assembleRedditVideo(input: {
  filePath: string;
  cleanup: () => Promise<void>;
}): Promise<{ filePath: string; cleanup: () => Promise<void> }> {
  return input;
}
