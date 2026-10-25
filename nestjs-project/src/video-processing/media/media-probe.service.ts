import { Injectable } from '@nestjs/common';
import { FfmpegRunner } from './ffmpeg-runner';
import { isInvalidInput, MediaInvalidError, redactInput } from './media.errors';

export const PROBE_TIMEOUT_MS = 60000;

export interface MediaMetadata {
  durationSeconds: number;
  width: number;
  height: number;
  videoCodec: string;
  audioCodec: string | null;
  formatName: string;
  bitrate: number | null;
  frameRate: number | null;
  sizeBytes: number | null;
}

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
}

interface FfprobeOutput {
  streams?: FfprobeStream[];
  format?: {
    format_name?: string;
    duration?: string;
    bit_rate?: string;
    size?: string;
  };
}

/** Converts ffprobe's rational `r_frame_rate` ("30000/1001") to fps with 3 decimals. */
export function parseFrameRate(rate: string | undefined): number | null {
  if (!rate) return null;
  const [num, den = '1'] = rate.split('/');
  const fps = Number(num) / Number(den);
  return Number.isFinite(fps) && fps > 0 ? Math.round(fps * 1000) / 1000 : null;
}

const toNumberOrNull = (value: string | undefined): number | null => {
  const n = Number(value);
  return value !== undefined && Number.isFinite(n) ? n : null;
};

@Injectable()
export class MediaProbeService {
  constructor(private readonly runner: FfmpegRunner) {}

  async probe(url: string): Promise<MediaMetadata> {
    let output: FfprobeOutput;
    try {
      const { stdout } = await this.runner.run(
        'ffprobe',
        [
          '-v',
          'error',
          '-print_format',
          'json',
          '-show_format',
          '-show_streams',
          url,
        ],
        PROBE_TIMEOUT_MS,
      );
      output = JSON.parse(stdout) as FfprobeOutput;
    } catch (err) {
      const redacted = redactInput(err, url);
      if (isInvalidInput(redacted)) {
        throw new MediaInvalidError(redacted.stderr.trim());
      }
      throw redacted;
    }

    const video = output.streams?.find((s) => s.codec_type === 'video');
    const audio = output.streams?.find((s) => s.codec_type === 'audio');
    const durationSeconds = toNumberOrNull(output.format?.duration);

    if (!video) throw new MediaInvalidError('no video stream');
    if (!durationSeconds || durationSeconds <= 0) {
      throw new MediaInvalidError('missing or non-positive duration');
    }

    return {
      durationSeconds,
      width: video.width ?? 0,
      height: video.height ?? 0,
      videoCodec: video.codec_name ?? 'unknown',
      audioCodec: audio?.codec_name ?? null,
      formatName: output.format?.format_name ?? 'unknown',
      bitrate: toNumberOrNull(output.format?.bit_rate),
      frameRate: parseFrameRate(video.r_frame_rate),
      sizeBytes: toNumberOrNull(output.format?.size),
    };
  }
}
