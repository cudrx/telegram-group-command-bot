import { describe, expect, test } from 'vitest';

import { parseTelegramChannelPosts } from '../../../src/app/actions/news/parser.js';

describe('parseTelegramChannelPosts', () => {
  test('extracts post id, date, text, and canonical url from public Telegram HTML', () => {
    const html = `
      <div class="tgme_widget_message_wrap js-widget_message_wrap">
        <div class="tgme_widget_message text_not_supported_wrap js-widget_message" data-post="thedailyblogteam/202402">
          <div class="tgme_widget_message_text js-message_text" dir="auto">
            <b>Россия и Китай</b><br/><br/>Текст с &#036;45 000 и <tg-emoji emoji-id="1"><i><b>🇷🇺</b></i></tg-emoji>.
          </div>
          <a class="tgme_widget_message_date" href="https://t.me/thedailyblogteam/202402">
            <time datetime="2026-05-20T08:36:47+00:00" class="time">08:36</time>
          </a>
        </div>
      </div>
    `;

    expect(parseTelegramChannelPosts(html, 'thedailyblogteam')).toEqual([
      {
        sourceSlug: 'thedailyblogteam',
        messageId: 202402,
        publishedAt: '2026-05-20T08:36:47+00:00',
        text: 'Россия и Китай\n\nТекст с $45 000 и 🇷🇺.',
        url: 'https://t.me/thedailyblogteam/202402'
      }
    ]);
  });

  test('skips grouped media fragments and posts without message text', () => {
    const html = `
      <div class="tgme_widget_message js-widget_message" data-post="thedailyblogteam/202406g">
        <time datetime="2026-05-20T08:40:24+00:00"></time>
      </div>
      <div class="tgme_widget_message js-widget_message" data-post="thedailyblogteam/202409">
        <div class="tgme_widget_message_text js-message_text" dir="auto">Важный текст</div>
        <time datetime="2026-05-20T08:42:34+00:00"></time>
      </div>
    `;

    expect(parseTelegramChannelPosts(html, 'thedailyblogteam')).toEqual([
      {
        sourceSlug: 'thedailyblogteam',
        messageId: 202409,
        publishedAt: '2026-05-20T08:42:34+00:00',
        text: 'Важный текст',
        url: 'https://t.me/thedailyblogteam/202409'
      }
    ]);
  });
});
