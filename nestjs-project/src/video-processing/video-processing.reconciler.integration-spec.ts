import * as crypto from 'crypto';
import { getQueueToken } from '@nestjs/bullmq';
import { TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Worker, type Queue } from 'bullmq';
import { DataSource, Repository } from 'typeorm';
import { Channel } from '../channels/entities/channel.entity';
import { cleanAllTables } from '../test/create-test-data-source';
import { createVideoTestingModule } from '../test/video-test-module';
import { User } from '../users/entities/user.entity';
import { Video, VideoProcessingStatus } from '../videos/entities/video.entity';
import { generatePublicId } from '../videos/public-id.util';
import { VideoProcessingQueueModule } from './video-processing-queue.module';
import { VIDEO_PROCESSING_QUEUE } from './video-processing.constants';
import { VideoProcessingPublisher } from './video-processing.publisher';
import { VideoProcessingReconciler } from './video-processing.reconciler';

describe('VideoProcessingReconciler (integration)', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let reconciler: VideoProcessingReconciler;
  let publisher: VideoProcessingPublisher;
  let queue: Queue;
  let videoRepository: Repository<Video>;
  let channelId: string;

  beforeAll(async () => {
    module = await createVideoTestingModule([
      {
        module: class ReconcilerTestModule {},
        imports: [
          TypeOrmModule.forFeature([Video]),
          VideoProcessingQueueModule,
        ],
        providers: [VideoProcessingReconciler],
        exports: [VideoProcessingReconciler, VideoProcessingQueueModule],
      },
    ]);
    dataSource = module.get(DataSource);
    reconciler = module.get(VideoProcessingReconciler);
    publisher = module.get(VideoProcessingPublisher);
    queue = module.get<Queue>(getQueueToken(VIDEO_PROCESSING_QUEUE));
    videoRepository = dataSource.getRepository(Video);
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    await queue.obliterate({ force: true });
    const user = await dataSource.getRepository(User).save({
      email: `reconciler_${crypto.randomUUID()}@example.com`,
      password: 'hashed',
    });
    const channel = await dataSource.getRepository(Channel).save({
      name: 'Reconciler',
      nickname: `rec-${crypto.randomUUID().slice(0, 8)}`,
      user_id: user.id,
    });
    channelId = channel.id;
  });

  const saveVideo = (processingStatus: VideoProcessingStatus) =>
    videoRepository.save({
      public_id: generatePublicId(),
      channel_id: channelId,
      title: 'aula',
      original_filename: 'aula.mp4',
      content_type: 'video/mp4',
      sizeBytes: 1024,
      processingStatus,
    });

  async function pendingJobCount(): Promise<number> {
    const counts = await queue.getJobCounts('waiting', 'delayed', 'active');
    return counts.waiting + counts.delayed + counts.active;
  }

  it('should re-enqueue a processing video that has no job', async () => {
    const orphan = await saveVideo(VideoProcessingStatus.PROCESSING);
    await saveVideo(VideoProcessingStatus.READY);

    expect(await reconciler.reconcile()).toBe(1);

    expect(await publisher.hasPendingJob(orphan.id)).toBe(true);
    expect(await pendingJobCount()).toBe(1);
  });

  it('should not duplicate a job that is already waiting', async () => {
    const video = await saveVideo(VideoProcessingStatus.PROCESSING);
    await publisher.enqueue(video.id);

    expect(await reconciler.reconcile()).toBe(0);

    expect(await pendingJobCount()).toBe(1);
  });

  it('should replace a retained failed job for a video still in processing', async () => {
    const video = await saveVideo(VideoProcessingStatus.PROCESSING);
    await queue.add(
      'process-video',
      { videoId: video.id },
      {
        jobId: video.id,
        attempts: 1,
      },
    );
    // A throwaway worker fails the job so it is retained in the failed set.
    const worker = new Worker(
      VIDEO_PROCESSING_QUEUE,
      () => Promise.reject(new Error('lost')),
      { connection: queue.opts.connection, prefix: queue.opts.prefix },
    );
    await new Promise<void>((resolve) =>
      worker.once('failed', () => resolve()),
    );
    await worker.close();
    expect(await queue.getJobState(video.id)).toBe('failed');

    expect(await reconciler.reconcile()).toBe(1);

    expect(await publisher.hasPendingJob(video.id)).toBe(true);
  });
});
