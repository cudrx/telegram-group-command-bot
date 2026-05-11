export const weeklyActionConfig = {
  rangeMs: 7 * 24 * 60 * 60 * 1000,
  eventExcerptLimit: 12,
  selection: {
    mergeGapMs: 5 * 60 * 1000,
    maxEvents: 10,
    minEvents: 6,
    maxEventsPerDay: 2
  },
  burst: {
    windowMs: 10 * 60 * 1000,
    expandGapMs: 5 * 60 * 1000,
    minMessages: 12,
    minParticipants: 2
  },
  mediaMoment: {
    denseWindowMs: 10 * 60 * 1000,
    denseMinMessages: 4
  },
  replies: {
    contextMessagesEachSide: 5,
    minHotspotReplies: 2,
    minChainMessages: 3,
    minChainReplies: 2
  },
  scoring: {
    participantWeight: 3,
    replyWeight: 2,
    maxRepliesToOneMessageWeight: 4,
    mediaSummaryWeight: 3
  },
  activityTiers: {
    highRatio: 0.6,
    mediumRatio: 0.25
  }
} as const;
