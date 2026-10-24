import { createMediaService } from '../src/media/service.js';

const kind = process.env.MEDIA_SERVICE_KIND;
if (kind !== 'video' && kind !== 'gallery')
  throw new Error('MEDIA_SERVICE_KIND must be video or gallery');

const service = createMediaService({
  kind,
  mediaRoot: process.env.MEDIA_ROOT ?? '/media',
  dataRoot: process.env.MEDIA_DATA_ROOT ?? '/app/data'
});
service.server.listen(
  Number(process.env.MEDIA_PORT ?? 8080),
  process.env.MEDIA_HOST ?? '127.0.0.1'
);
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void service.stop().then(() => process.exit(0));
  });
}
