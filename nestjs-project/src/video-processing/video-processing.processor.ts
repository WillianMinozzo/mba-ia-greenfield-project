import { readFile } from 'fs/promises';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { type Job, UnrecoverableError } from 'bullmq';
import { Repository } from 'typeorm';
import { videoOriginalKey, videoThumbnailKey } from '../storage/storage-keys';
import { StorageService } from '../storage/storage.service';
import { Video, VideoProcessingStatus } from '../videos/entities/video.entity';
import { MediaProbeService } from './media/media-probe.service';
import { MediaInvalidError, ThumbnailFailedError } from './media/media.errors';
import { ThumbnailService } from './media/thumbnail.service';
import {
  VIDEO_PROCESSING_QUEUE,
  type ProcessVideoJobData,
} from './video-processing.constants';

const PROCESSING_ERROR_MAX_LENGTH = 255;
const PROCESSING_FAILED = 'PROCESSING_FAILED';

/** Permanent media errors skip the retry policy; everything else is retried with backoff. */
function toUnrecoverable(err: unknown): unknown {
  if (err instanceof MediaInvalidError || err instanceof ThumbnailFailedError) {
    return new UnrecoverableError(`${err.code}: ${err.message}`);
  }
  return err;
}

export function processingErrorFor(error: Error): string {
  const message =
    error.name === 'UnrecoverableError'
      ? error.message
      : `${PROCESSING_FAILED}: ${error.message}`;
  return message.slice(0, PROCESSING_ERROR_MAX_LENGTH);
}

export function isFinalFailure(
  job: Pick<Job, 'attemptsMade' | 'opts'>,
  error: Error,
): boolean {
  return (
    error.name === 'UnrecoverableError' ||
    job.attemptsMade >= (job.opts.attempts ?? 1)
  );
}

@Processor(VIDEO_PROCESSING_QUEUE)
export class VideoProcessingProcessor extends WorkerHost {
  private readonly logger = new Logger(VideoProcessingProcessor.name);

  constructor(
    @InjectRepository(Video)
    private readonly videoRepository: Repository<Video>,
    private readonly storageService: StorageService,
    private readonly mediaProbe: MediaProbeService,
    private readonly thumbnails: ThumbnailService,
  ) {
    super();
  }

  async process(job: Job<ProcessVideoJobData>): Promise<void> {
    const { videoId } = job.data;
    const video = await this.videoRepository.findOneBy({ id: videoId });
    // Idempotent: redelivered or stale jobs for videos that left `processing` do nothing.
    if (video?.processingStatus !== VideoProcessingStatus.PROCESSING) return;

    const url = await this.storageService.presignInternalGetObject(
      videoOriginalKey(videoId),
    );

    try {
      const meta = await this.mediaProbe.probe(url);
      const thumbnail = await this.thumbnails.generate(
        url,
        meta.durationSeconds,
      );
      try {
        await this.storageService.putObject(
          videoThumbnailKey(videoId),
          await readFile(thumbnail.path),
          'image/jpeg',
        );
      } finally {
        await thumbnail.cleanup();
      }

      await this.videoRepository.update(
        { id: videoId },
        {
          durationSeconds: meta.durationSeconds,
          width: meta.width,
          height: meta.height,
          videoCodec: meta.videoCodec,
          audioCodec: meta.audioCodec,
          formatName: meta.formatName,
          bitrate: meta.bitrate,
          frameRate: meta.frameRate,
          sizeBytes: meta.sizeBytes ?? video.sizeBytes,
          processingStatus: VideoProcessingStatus.READY,
          processedAt: new Date(),
          processingError: null,
        },
      );
    } catch (err) {
      throw toUnrecoverable(err);
    }
  }

  @OnWorkerEvent('failed')
  async onFailed(
    job: Job<ProcessVideoJobData> | undefined,
    error: Error,
  ): Promise<void> {
    if (!job || !isFinalFailure(job, error)) return;

    // Background event handler: rethrowing would crash the worker, so log instead.
    try {
      await this.videoRepository.update(
        {
          id: job.data.videoId,
          processingStatus: VideoProcessingStatus.PROCESSING,
        },
        {
          processingStatus: VideoProcessingStatus.FAILED,
          processingError: processingErrorFor(error),
        },
      );
    } catch (err) {
      this.logger.error(
        `Could not mark video ${job.data.videoId} as failed`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }
}
