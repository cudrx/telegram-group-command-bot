import { text } from '../../../locales/locale.js';
import type { VideoJobSource } from '../../video-job-queue.js';
import { dispatchTextReply } from '../outbound-voice.js';
import type { MemeJobInput } from './send.js';

export async function runQueuedVideoJob<T>(input: {
  job: MemeJobInput;
  source: VideoJobSource;
  run: () => Promise<T>;
  beforeRun?: (() => Promise<void> | void) | undefined;
}): Promise<T> {
  const queue = input.job.deps.videoJobQueue;

  if (!queue) {
    await input.beforeRun?.();
    return input.run();
  }

  return queue.enqueue({
    chatId: input.job.request.chatId,
    source: input.source,
    triggerMessageId: input.job.request.triggerMessageId,
    onQueued: async () => {
      await dispatchTextReply({
        deps: input.job.deps,
        request: input.job.request,
        text: text.meme.videoQueuedFallback
      });
    },
    beforeRun: input.beforeRun,
    run: input.run
  });
}
