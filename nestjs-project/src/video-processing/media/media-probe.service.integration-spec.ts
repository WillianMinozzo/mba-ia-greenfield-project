import { join } from 'path';
import { FfmpegRunner } from './ffmpeg-runner';
import { MediaProbeService } from './media-probe.service';
import { MediaInvalidError } from './media.errors';

const FIXTURES = join(__dirname, '../../../test/fixtures/videos');

describe('MediaProbeService (integration — real ffprobe)', () => {
  const service = new MediaProbeService(new FfmpegRunner());

  it('should extract metrics from sample-2s.mp4', async () => {
    const meta = await service.probe(join(FIXTURES, 'sample-2s.mp4'));

    expect(meta.durationSeconds).toBeGreaterThanOrEqual(1.9);
    expect(meta.durationSeconds).toBeLessThanOrEqual(2.1);
    expect(meta).toMatchObject({
      width: 320,
      height: 240,
      frameRate: 25,
      videoCodec: 'h264',
      audioCodec: 'aac',
    });
    expect(meta.formatName).toContain('mp4');
    expect(meta.bitrate).toBeGreaterThan(0);
    expect(meta.sizeBytes).toBeGreaterThan(0);
  });

  it('should report a null audioCodec for no-audio-2s.mp4', async () => {
    const meta = await service.probe(join(FIXTURES, 'no-audio-2s.mp4'));

    expect(meta.audioCodec).toBeNull();
    expect(meta).toMatchObject({ width: 320, height: 240, videoCodec: 'h264' });
  });

  it('should reject invalid.mp4 with MediaInvalidError', async () => {
    await expect(
      service.probe(join(FIXTURES, 'invalid.mp4')),
    ).rejects.toBeInstanceOf(MediaInvalidError);
  });

  it('should treat an unreachable URL as transient, not as invalid media', async () => {
    const promise = service.probe('http://minio:9999/unreachable');

    await expect(promise).rejects.toThrow();
    await expect(promise).rejects.not.toBeInstanceOf(MediaInvalidError);
  });

  it('should never echo the input (a presigned URL) in error messages', async () => {
    const input = join(FIXTURES, 'invalid.mp4');

    const error = (await service
      .probe(input)
      .catch((e: unknown) => e)) as Error;

    expect(error).toBeInstanceOf(MediaInvalidError);
    expect(error.message).not.toContain(input);
    expect(error.message).toContain('<input>');
  });
});
