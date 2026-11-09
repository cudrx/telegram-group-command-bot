export const storageConfig = {
  sqlitePath: 'data/bot.sqlite',
  deployMetadataFile: '/app/deploy/deploy-metadata.json',
  retention: {
    mediaArtifactDays: 7,
    messageDays: 7
  },
  cleanup: {
    databaseIntervalHours: 24
  }
} as const;
