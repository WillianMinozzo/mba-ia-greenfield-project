import { mkdtemp, rm, stat } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { Injectable } from '@nestjs/common';
import { FfmpegRunner } from './ffmpeg-runner';
import {
  isInvalidInput,
  redactInput,
  ThumbnailFailedError,
} from './media.errors';

export const THUMBNAIL_TIMEOUT_MS = 120000;
const THUMBNAIL_WIDTH = 1280;

/** Frame at 10% of the video, clamped to [1s, duration]; videos shorter than 1s use t = 0. */
export function thumbnailTimestamp(durationSeconds: number): number {
  if (durationSeconds < 1) return 0;
  return Math.min(Math.max(durationSeconds * 0.1, 1), durationSeconds);
}

export interface GeneratedThumbnail {
  path: string;
  /** Removes the temporary directory holding the thumbnail. */
  cleanup: () => Promise<void>;
}

@Injectable()
export class ThumbnailService {
  constructor(private readonly runner: FfmpegRunner) {}

  async generate(
    url: string,
    durationSeconds: number,
  ): Promise<GeneratedThumbnail> {
    const dir = await mkdtemp(join(tmpdir(), 'thumbnail-'));
    const path = join(dir, 'thumbnail.jpg');
    const cleanup = () => rm(dir, { recursive: true, force: true });

    try {
      await this.runner.run(
        'ffmpeg',
        [
          '-v',
          'error',
          '-y',
          '-ss',
          String(thumbnailTimestamp(durationSeconds)),
          '-i',
          url,
          '-frames:v',
          '1',
          '-vf',
          `scale=${THUMBNAIL_WIDTH}:-2`,
          path,
        ],
        THUMBNAIL_TIMEOUT_MS,
      );
      const file = await stat(path).catch(() => null);
      if (!file || file.size === 0) {
        throw new ThumbnailFailedError('ffmpeg produced no frame');
      }
      return { path, cleanup };
    } catch (err) {
      await cleanup();
      const redacted = redactInput(err, url);
      if (isInvalidInput(redacted)) {
        throw new ThumbnailFailedError(redacted.stderr.trim());
      }
      throw redacted;
    }
  }
}
