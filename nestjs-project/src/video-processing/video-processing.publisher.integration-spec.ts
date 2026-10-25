import * as crypto from 'crypto';
import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import type { Queue } from 'bullmq';
import queueConfig from '../config/queue.config';
import { VideoProcessingQueueModule } from './video-processing-queue.module';
import {
  PROCESS_VIDEO_JOB,
  VIDEO_PROCESSING_QUEUE,
} from './video-processing.constants';
import { VideoProcessingPublisher } from './video-processing.publisher';

describe('VideoProcessingPublisher (integration)', () => {
  let module: TestingModule;
  let publisher: VideoProcessingPublisher;
  let queue: Queue;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [queueConfig] }),
        // Unique prefix isolates this suite's keys from the app's queue in Redis.
        BullModule.forRoot({
          connection: {
            host: process.env.REDIS_HOST ?? 'redis',
            port: Number(process.env.REDIS_PORT ?? 6379),
          },
          prefix: `test-publisher-${crypto.randomUUID()}`,
        }),
        VideoProcessingQueueModule,
      ],
    }).compile();
    await module.init();

    publisher = module.get(VideoProcessingPublisher);
    queue = module.get<Queue>(getQueueToken(VIDEO_PROCESSING_QUEUE));
  });

  afterEach(async () => {
    await queue.obliterate({ force: true });
  });

  afterAll(async () => {
    await module.close();
  });

  it('should add a process-video job keyed by the video id with the queue retry policy', async () => {
    const videoId = crypto.randomUUID();

    await publisher.enqueue(videoId);

    const job = await queue.getJob(videoId);
    expect(job).toBeDefined();
    expect(job!.name).toBe(PROCESS_VIDEO_JOB);
    expect(job!.data).toEqual({ videoId });
    expect(job!.opts.attempts).toBe(3);
    expect(job!.opts.backoff).toEqual({ type: 'exponential', delay: 30000 });
    expect(await job!.getState()).toBe('waiting');
  });

  it('should not create a second job when the same video is enqueued twice', async () => {
    const videoId = crypto.randomUUID();

    await publisher.enqueue(videoId);
    await publisher.enqueue(videoId);

    const counts = await queue.getJobCounts('waiting', 'delayed', 'active');
    expect(counts.waiting + counts.delayed + counts.active).toBe(1);
  });

  it('should report a pending job only while it exists in the queue', async () => {
    const videoId = crypto.randomUUID();
    expect(await publisher.hasPendingJob(videoId)).toBe(false);

    await publisher.enqueue(videoId);
    expect(await publisher.hasPendingJob(videoId)).toBe(true);

    await queue.remove(videoId);
    expect(await publisher.hasPendingJob(videoId)).toBe(false);
  });
});
