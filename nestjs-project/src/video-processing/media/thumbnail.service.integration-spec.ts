import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { FfmpegRunner } from './ffmpeg-runner';
import { MediaProbeService } from './media-probe.service';
import { ThumbnailFailedError } from './media.errors';
import { ThumbnailService } from './thumbnail.service';

const FIXTURES = join(__dirname, '../../../test/fixtures/videos');

describe('ThumbnailService (integration — real ffmpeg)', () => {
  const runner = new FfmpegRunner();
  const service = new ThumbnailService(runner);

  it('should write a readable JPEG no wider than 1280px from sample-2s.mp4', async () => {
    const thumbnail = await service.generate(
      join(FIXTURES, 'sample-2s.mp4'),
      2,
    );

    try {
      const bytes = await readFile(thumbnail.path);
      expect(bytes.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));

      const meta = await new MediaProbeService(runner).probe(thumbnail.path);
      expect(meta.width).toBeLessThanOrEqual(1280);
      expect(meta.videoCodec).toBe('mjpeg');
    } finally {
      await thumbnail.cleanup();
    }
    expect(existsSync(thumbnail.path)).toBe(false);
  });

  it('should reject invalid.mp4 with ThumbnailFailedError', async () => {
    await expect(
      service.generate(join(FIXTURES, 'invalid.mp4'), 2),
    ).rejects.toBeInstanceOf(ThumbnailFailedError);
  });
});
