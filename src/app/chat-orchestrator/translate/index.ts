import type { ReplyContext } from '../../../domain/models.js';
import type { LlmReplyResult } from '../../../llm/openai-compatible-client/index.js';
import type { DescribeMediaContext } from '../../../llm/prompts.js';
import { text } from '../../../locales/locale.js';
import {
  collectTranslateBlocks,
  createTranslateBlockMessage,
  filterTranslatableBlocks
} from '../../actions/translate/blocks.js';
import { createLocalReplyResult } from '../helpers/reply.js';
import type { ReplyJobRequest } from '../types.js';

export function prepareTranslateReply(input: {
  request: ReplyJobRequest;
  replyContext: ReplyContext;
  mediaContext: DescribeMediaContext | null;
}):
  | { ok: true; replyContext: ReplyContext }
  | { ok: false; result: LlmReplyResult } {
  const targetMessage = input.replyContext.replyAnchorMessage;

  if (!targetMessage) {
    return {
      ok: false,
      result: createLocalReplyResult(text.translate.usageFallback)
    };
  }

  const targetWithRequestMedia = input.request.replyToMediaSnapshot
    ? {
        ...targetMessage,
        mediaSnapshot:
          targetMessage.mediaSnapshot ?? input.request.replyToMediaSnapshot
      }
    : targetMessage;
  const blocks = collectTranslateBlocks({
    targetMessage: targetWithRequestMedia,
    mediaContext: input.mediaContext
  });

  if (blocks.length === 0) {
    return {
      ok: false,
      result: createLocalReplyResult(text.translate.noMaterialFallback)
    };
  }

  const translatableBlocks = filterTranslatableBlocks(blocks);

  if (translatableBlocks.length === 0) {
    return {
      ok: false,
      result: createLocalReplyResult(
        text.translate.alreadyTargetLanguageFallback
      )
    };
  }

  return {
    ok: true,
    replyContext: {
      ...input.replyContext,
      replyAnchorMessage: createTranslateBlockMessage(
        targetWithRequestMedia,
        translatableBlocks
      )
    }
  };
}
