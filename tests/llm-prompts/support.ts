export function createPromptReplyContext(commandText: string) {
  return {
    triggerMessage: {
      chatId: 1,
      messageId: 3,
      userId: 1,
      senderDisplayName: 'Tom',
      text: commandText,
      createdAt: '2026-04-03T12:00:00.000Z',
      isBot: false,
      replyToMessageId: null
    },
    replyAnchorMessage: null,
    priorContextMessages: []
  };
}
