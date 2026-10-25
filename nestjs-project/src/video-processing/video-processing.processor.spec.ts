import { UnrecoverableError, type Job } from 'bullmq';
import type { Repository } from 'typeorm';
import type { StorageService } from '../storage/storage.service';
import { Video, VideoProcessingStatus } from '../videos/entities/video.entity';
import type { MediaProbeService } from './media/media-probe.service';
import type { ThumbnailService } from './media/thumbnail.service';
import type { ProcessVideoJobData } from './video-processing.constants';
import { VideoProcessingProcessor } from './video-processing.processor';

function buildJob(attemptsMade: number): Job<ProcessVideoJobData> {
  return {
    attemptsMade,
    opts: { attempts: 3 },
    data: { videoId: 'video-1' },
  } as unknown as Job<ProcessVideoJobData>;
}

describe('VideoProcessingProcessor (failed event)', () => {
  const videoRepository = { update: jest.fn() };
  let processor: VideoProcessingProcessor;

  beforeEach(() => {
    jest.resetAllMocks();
    processor = new VideoProcessingProcessor(
      videoRepository as unknown as Repository<Video>,
      {} as StorageService,
      {} as MediaProbeService,
      {} as ThumbnailService,
    );
  });

  it('should not mark the video failed on an intermediate transient attempt', async () => {
    await processor.onFailed(buildJob(1), new Error('storage down'));

    expect(videoRepository.update).not.toHaveBeenCalled();
  });

  it('should mark PROCESSING_FAILED once the transient retries are exhausted', async () => {
    await processor.onFailed(buildJob(3), new Error('storage down'));

    expect(videoRepository.update).toHaveBeenCalledWith(
      { id: 'video-1', processingStatus: VideoProcessingStatus.PROCESSING },
      {
        processingStatus: VideoProcessingStatus.FAILED,
        processingError: 'PROCESSING_FAILED: storage down',
      },
    );
  });

  it.each([
    'MEDIA_INVALID: moov atom not found',
    'THUMBNAIL_FAILED: ffmpeg produced no frame',
  ])(
    'should mark failed on the first attempt for UnrecoverableError %p',
    async (message) => {
      await processor.onFailed(buildJob(1), new UnrecoverableError(message));

      expect(videoRepository.update).toHaveBeenCalledWith(expect.anything(), {
        processingStatus: VideoProcessingStatus.FAILED,
        processingError: message,
      });
    },
  );

  it('should truncate the stored error to the column size', async () => {
    await processor.onFailed(buildJob(3), new Error('x'.repeat(400)));

    const [, changes] = videoRepository.update.mock.calls[0] as [
      unknown,
      { processingError: string },
    ];
    expect(changes.processingError).toHaveLength(255);
  });

  it('should log instead of throwing when the failure cannot be persisted', async () => {
    videoRepository.update.mockRejectedValue(new Error('db down'));

    await expect(
      processor.onFailed(buildJob(3), new Error('storage down')),
    ).resolves.toBeUndefined();
  });
});
