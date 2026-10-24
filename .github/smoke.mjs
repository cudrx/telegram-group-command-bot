import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { createMediaService } from './dist/src/media/service.js';
import { createRemoteMediaExec } from './dist/src/media/service-client.js';

assert.equal(process.getuid(), 1000);
assert.equal(process.getgid(), 1000);
const kind = process.env.MEDIA_SERVICE_KIND;
if (!kind) {
  const { default: Database } = await import('better-sqlite3');
  const db = new Database('/app/data/smoke.sqlite');
  db.exec('CREATE TABLE smoke (id INTEGER)');
  db.close();
  await rm('/app/data/smoke.sqlite');
} else {
  const service = createMediaService({
    kind,
    mediaRoot: '/media',
    dataRoot: '/app/data'
  });
  service.server.listen(0, '127.0.0.1');
  await once(service.server, 'listening');
  const url = `http://127.0.0.1:${service.server.address().port}`;
  const exec = createRemoteMediaExec({
    videoUrl: url,
    galleryUrl: url,
    pollMs: 10
  });
  try {
    if (kind === 'video') {
      await exec('yt-dlp', ['--version']);
      await exec('ffmpeg', [
        '-y',
        '-f',
        'lavfi',
        '-i',
        'color=size=160x120:duration=0.2',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=1000:duration=0.2',
        '-c:v',
        'libx264',
        '-c:a',
        'aac',
        '/media/smoke.mp4'
      ]);
      const probe = await exec('ffprobe', [
        '-v',
        'error',
        '-show_entries',
        'stream=width,height',
        '-of',
        'json',
        '/media/smoke.mp4'
      ]);
      assert.equal(JSON.parse(probe.stdout).streams[0].width, 160);
      const metadata = await exec('yt-dlp', [
        '--enable-file-urls',
        '--cookies',
        '/app/data/optional-cookies.txt',
        '--dump-single-json',
        'file:///media/smoke.mp4'
      ]);
      assert.equal(JSON.parse(metadata.stdout).id, 'smoke');
      await assert.rejects(readFile('/app/data/optional-cookies.txt'), {
        code: 'ENOENT'
      });
      await exec('ffmpeg', [
        '-y',
        '-i',
        '/media/smoke.mp4',
        '-vn',
        '-c:a',
        'libopus',
        '/media/smoke.ogg'
      ]);
      assert.ok((await readFile('/media/smoke.ogg')).length > 0);
    } else {
      await exec('gallery-dl', ['--version']);
    }
    await writeFile('/media/smoke-access', 'ok');
    assert.equal(await readFile('/media/smoke-access', 'utf8'), 'ok');
  } finally {
    await service.stop();
  }
}
console.log('Image smoke check passed');
