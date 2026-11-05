export function createConversationGraph(messageIds: number[] = []) {
  return {
    discussions: messageIds.length ? [{ id: 'discussion', messageIds }] : [],
    inferredLinks: [],
    selectedDiscussionIds: messageIds.length ? ['discussion'] : []
  };
}
