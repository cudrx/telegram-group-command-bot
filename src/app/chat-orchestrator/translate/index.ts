import type { ReplyContext } from '../../../domain/models.js';
import type { LlmReplyResult } from '../../../llm/openai-compatible-client/index.js';
import type { DescribeMediaContext } from '../../../llm/prompts.js';
import {
  collectTranslateBlocks,
  createTranslateBlockMessage,
  filterTranslatableBlocks
} from '../../actions/translate/blocks.js';
import {
  createLocalReplyResult,
  TRANSLATE_ALREADY_RUSSIAN_PLACEHOLDER,
  TRANSLATE_NO_MATERIAL_PLACEHOLDER,
  TRANSLATE_USAGE_PLACEHOLDER
} from '../helpers/reply.js';
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
      result: createLocalReplyResult(TRANSLATE_USAGE_PLACEHOLDER)
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
      result: createLocalReplyResult(TRANSLATE_NO_MATERIAL_PLACEHOLDER)
    };
  }

  const translatableBlocks = filterTranslatableBlocks(blocks);

  if (translatableBlocks.length === 0) {
    return {
      ok: false,
      result: createLocalReplyResult(TRANSLATE_ALREADY_RUSSIAN_PLACEHOLDER)
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
