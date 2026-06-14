import { describe, expect, test, vi } from 'vitest';

import { createTelegramDispatchers } from '../src/app/telegram-dispatchers.js';

describe('createTelegramDispatchers', () => {
  test('splits large galleries into Telegram-sized albums', async () => {
    const sendMediaGroup = vi
      .fn()
      .mockResolvedValueOnce(
        Array.from({ length: 10 }, (_, index) => ({
          message_id: index + 100,
          date: 1_747_000_000,
          photo: [
            { file_id: `photo-${index}`, file_unique_id: `unique-${index}` }
          ]
        }))
      )
      .mockResolvedValueOnce([
        {
          message_id: 200,
          date: 1_747_000_001,
          photo: [{ file_id: 'photo-10', file_unique_id: 'unique-10' }]
        }
      ]);
    const dispatchers = createTelegramDispatchers({
      sendMessage: vi.fn(),
      editMessageText: vi.fn(),
      sendVoice: vi.fn(),
      sendPhoto: vi.fn(),
      sendVideo: vi.fn(),
      sendMediaGroup,
      deleteMessage: vi.fn(),
      sendChatAction: vi.fn()
    });

    const result = await dispatchers.memeDispatcher({
      chatId: 1,
      replyToMessageId: 10,
      reply: true,
      caption: 'album caption',
      media: {
        kind: 'gallery',
        items: Array.from({ length: 11 }, (_, index) => ({
          filePath: `/tmp/${index}.jpg`,
          hasSpoiler: true
        }))
      }
    });

    expect(sendMediaGroup).toHaveBeenCalledTimes(2);
    expect(sendMediaGroup).toHaveBeenNthCalledWith(
      1,
      1,
      expect.arrayContaining([
        expect.objectContaining({
          caption: 'album caption',
          parse_mode: 'HTML',
          has_spoiler: true
        })
      ]),
      {
        reply_parameters: {
          message_id: 10
        }
      }
    );
    expect(sendMediaGroup.mock.calls[0]?.[1]).toHaveLength(10);
    expect(sendMediaGroup.mock.calls[1]?.[1]).toHaveLength(1);
    expect(sendMediaGroup.mock.calls[1]?.[1]?.[0]).toEqual(
      expect.objectContaining({
        type: 'photo',
        has_spoiler: true
      })
    );
    expect(sendMediaGroup.mock.calls[1]?.[1]?.[0]).not.toHaveProperty(
      'caption'
    );
    expect(result).toMatchObject({
      messageId: 100
    });
  });
});
