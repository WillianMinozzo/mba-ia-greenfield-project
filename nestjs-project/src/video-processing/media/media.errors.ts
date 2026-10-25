/** The file itself is unreadable or not a video — retrying cannot help (permanent). */
export class MediaInvalidError extends Error {
  readonly code = 'MEDIA_INVALID';

  constructor(message: string) {
    super(message);
    this.name = 'MediaInvalidError';
  }
}

/** ffmpeg finished without producing the thumbnail frame (permanent). */
export class ThumbnailFailedError extends Error {
  readonly code = 'THUMBNAIL_FAILED';

  constructor(message: string) {
    super(message);
    this.name = 'ThumbnailFailedError';
  }
}

/** A ffmpeg/ffprobe process exited non-zero or timed out. */
export class FfmpegRunError extends Error {
  constructor(
    message: string,
    readonly exitCode: number | null,
    readonly stderr: string,
    readonly timedOut = false,
  ) {
    super(message);
    this.name = 'FfmpegRunError';
  }
}

const REDACTED_INPUT = '<input>';

/**
 * ffmpeg echoes its input in messages and stderr; for presigned URLs that includes the
 * signature, which must never reach logs, Redis or `processing_error`.
 */
export function redactInput(error: unknown, input: string): unknown {
  if (!(error instanceof FfmpegRunError)) return error;
  const redact = (text: string) => text.split(input).join(REDACTED_INPUT);
  return new FfmpegRunError(
    redact(error.message),
    error.exitCode,
    redact(error.stderr),
    error.timedOut,
  );
}

// stderr markers of a corrupt or non-media input; anything else (network, 403, timeout) is transient.
const INVALID_INPUT_PATTERN =
  /Invalid data found when processing input|moov atom not found/i;

export function isInvalidInput(error: unknown): error is FfmpegRunError {
  return (
    error instanceof FfmpegRunError &&
    !error.timedOut &&
    INVALID_INPUT_PATTERN.test(error.stderr)
  );
}
