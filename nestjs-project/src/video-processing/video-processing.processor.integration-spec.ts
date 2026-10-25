import * as crypto from 'crypto';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UnrecoverableError, type Job } from 'bullmq';
import { DataSource, Repository } from 'typeorm';
import { Channel } from '../channels/entities/channel.entity';
import { videoOriginalKey, videoThumbnailKey } from '../storage/storage-keys';
import { StorageModule } from '../storage/storage.module';
import { StorageService } from '../storage/storage.service';
import { cleanAllTables } from '../test/create-test-data-source';
import { createVideoTestingModule } from '../test/video-test-module';
import { User } from '../users/entities/user.entity';
import { Video, VideoProcessingStatus } from '../videos/entities/video.entity';
import { generatePublicId } from '../videos/public-id.util';
import { FfmpegRunner } from './media/ffmpeg-runner';
import { MediaProbeService } from './media/media-probe.service';
import { ThumbnailService } from './media/thumbnail.service';
import type { ProcessVideoJobData } from './video-processing.constants';
import { VideoProcessingProcessor } from './video-processing.processor';

const FIXTURES = join(__dirname, '../../test/fixtures/videos');

describe('VideoProcessingProcessor (integration)', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let processor: VideoProcessingProcessor;
  let storage: StorageService;
  let videoRepository: Repository<Video>;
  let channelId: string;

  beforeAll(async () => {
    module = await createVideoTestingModule([
      TypeOrmModule.forFeature([Video]),
      StorageModule,
      {
        module: class ProcessorTestModule {},
        imports: [TypeOrmModule.forFeature([Video]), StorageModule],
        providers: [
          FfmpegRunner,
          MediaProbeService,
          ThumbnailService,
          VideoProcessingProcessor,
        ],
        exports: [VideoProcessingProcessor],
      },
    ]);
    dataSource = module.get(DataSource);
    processor = module.get(VideoProcessingProcessor);
    storage = module.get(StorageService);
    videoRepository = dataSource.getRepository(Video);
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    const user = await dataSource.getRepository(User).save({
      email: `processor_${crypto.randomUUID()}@example.com`,
      password: 'hashed',
    });
    const channel = await dataSource.getRepository(Channel).save({
      name: 'Processor',
      nickname: `proc-${crypto.randomUUID().slice(0, 8)}`,
      user_id: user.id,
    });
    channelId = channel.id;
  });

  async function arrangeVideo(
    fixture: string,
    processingStatus = VideoProcessingStatus.PROCESSING,
  ): Promise<Video> {
    const bytes = await readFile(join(FIXTURES, fixture));
    const video = await videoRepository.save({
      public_id: generatePublicId(),
      channel_id: channelId,
      title: fixture,
      original_filename: fixture,
      content_type: 'video/mp4',
      sizeBytes: bytes.length,
      processingStatus,
    });
    await storage.putObject(videoOriginalKey(video.id), bytes, 'video/mp4');
    return video;
  }

  const jobFor = (video: Video) =>
    ({ data: { videoId: video.id } }) as Job<ProcessVideoJobData>;

  it('should leave the video ready with metrics and upload the thumbnail', async () => {
    const video = await arrangeVideo('sample-2s.mp4');

    await processor.process(jobFor(video));

    const row = await videoRepository.findOneByOrFail({ id: video.id });
    expect(row.processingStatus).toBe(VideoProcessingStatus.READY);
    expect(row.processedAt).toBeInstanceOf(Date);
    expect(row.processingError).toBeNull();
    expect(row.durationSeconds).toBeGreaterThanOrEqual(1.9);
    expect(row).toMatchObject({
      width: 320,
      height: 240,
      frameRate: 25,
      videoCodec: 'h264',
      audioCodec: 'aac',
    });

    const thumbnail = await storage.headObject(videoThumbnailKey(video.id));
    expect(thumbnail.contentType).toBe('image/jpeg');
    expect(thumbnail.contentLength).toBeGreaterThan(0);
  }, 60000);

  it('should throw UnrecoverableError with MEDIA_INVALID for invalid.mp4', async () => {
    const video = await arrangeVideo('invalid.mp4');

    const promise = processor.process(jobFor(video));

    await expect(promise).rejects.toBeInstanceOf(UnrecoverableError);
    await expect(promise).rejects.toThrow(/^MEDIA_INVALID: /);
  }, 60000);

  it('should do nothing for a video that is not processing', async () => {
    const video = await arrangeVideo(
      'sample-2s.mp4',
      VideoProcessingStatus.READY,
    );

    await processor.process(jobFor(video));

    const row = await videoRepository.findOneByOrFail({ id: video.id });
    expect(row.durationSeconds).toBeNull();
    await expect(
      storage.headObject(videoThumbnailKey(video.id)),
    ).rejects.toMatchObject({ name: 'NotFound' });
  });

  it('should do nothing for a job whose video no longer exists', async () => {
    await expect(
      processor.process({
        data: { videoId: crypto.randomUUID() },
      } as Job<ProcessVideoJobData>),
    ).resolves.toBeUndefined();
  });
});
