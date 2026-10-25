import * as crypto from 'crypto';
import { getQueueToken } from '@nestjs/bullmq';
import { TestingModule } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import { DataSource, Repository } from 'typeorm';
import { Channel } from '../channels/entities/channel.entity';
import { videoOriginalKey } from '../storage/storage-keys';
import { StorageService } from '../storage/storage.service';
import { cleanAllTables } from '../test/create-test-data-source';
import { createVideoTestingModule } from '../test/video-test-module';
import { User } from '../users/entities/user.entity';
import {
  PROCESS_VIDEO_JOB,
  VIDEO_PROCESSING_QUEUE,
} from '../video-processing/video-processing.constants';
import { Video, VideoProcessingStatus } from './entities/video.entity';
import { VIDEO_PART_SIZE } from './videos.constants';
import { VideosModule } from './videos.module';
import { VideosService } from './videos.service';

describe('VideosService (integration)', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let videosService: VideosService;
  let storageService: StorageService;
  let videoRepository: Repository<Video>;
  let queue: Queue;
  let userId: string;

  beforeAll(async () => {
    module = await createVideoTestingModule([VideosModule]);
    dataSource = module.get(DataSource);
    videosService = module.get(VideosService);
    storageService = module.get(StorageService);
    videoRepository = dataSource.getRepository(Video);
    queue = module.get<Queue>(getQueueToken(VIDEO_PROCESSING_QUEUE));
  });

  afterEach(async () => {
    await queue.obliterate({ force: true });
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    const user = await dataSource.getRepository(User).save({
      email: `videos_${crypto.randomUUID()}@example.com`,
      password: 'hashed',
    });
    await dataSource.getRepository(Channel).save({
      name: 'Owner',
      nickname: `owner-${crypto.randomUUID().slice(0, 8)}`,
      user_id: user.id,
    });
    userId = user.id;
  });

  async function putPart(video: Video, partNumber: number, size: number) {
    const [{ url }] = await videosService.signPartUrls(
      userId,
      video.public_id,
      [partNumber],
    );
    const res = await fetch(url, {
      method: 'PUT',
      body: crypto.randomBytes(size),
    });
    expect(res.status).toBe(200);
    return res.headers.get('etag');
  }

  it('should pre-register an awaiting_upload draft bound to a live multipart upload', async () => {
    const { video, partCount } = await videosService.initiateUpload(userId, {
      filename: 'aula final.mp4',
      contentType: 'video/mp4',
      sizeBytes: 10737418240,
    });

    const row = await videoRepository.findOneByOrFail({ id: video.id });
    expect(partCount).toBe(160);
    expect(row.title).toBe('aula final');
    expect(row.processingStatus).toBe(VideoProcessingStatus.AWAITING_UPLOAD);
    expect(row.upload_id).toBeTruthy();
    await expect(
      storageService.listParts(videoOriginalKey(video.id), row.upload_id!),
    ).resolves.toEqual([]);

    await videosService.abortUpload(userId, video.public_id);
  });

  it('should list the parts sent with PUT to the signed URLs', async () => {
    const { video } = await videosService.initiateUpload(userId, {
      filename: 'aula.mp4',
      contentType: 'video/mp4',
      sizeBytes: 1024,
    });
    const etag = await putPart(video, 1, 1024);

    const parts = await videosService.listUploadedParts(
      userId,
      video.public_id,
    );

    expect(parts).toEqual([{ partNumber: 1, sizeBytes: 1024, etag }]);
    await videosService.abortUpload(userId, video.public_id);
  });

  it('should complete a real 2-part upload, move to processing and enqueue exactly one job', async () => {
    const lastPart = 1024;
    const { video } = await videosService.initiateUpload(userId, {
      filename: 'aula.mp4',
      contentType: 'video/mp4',
      sizeBytes: VIDEO_PART_SIZE + lastPart,
    });
    await putPart(video, 1, VIDEO_PART_SIZE);
    await putPart(video, 2, lastPart);

    const completed = await videosService.completeUpload(
      userId,
      video.public_id,
    );
    await videosService.completeUpload(userId, video.public_id);

    const row = await videoRepository.findOneByOrFail({ id: video.id });
    expect(completed.processingStatus).toBe(VideoProcessingStatus.PROCESSING);
    expect(row.processingStatus).toBe(VideoProcessingStatus.PROCESSING);
    expect(row.upload_id).toBeNull();
    expect(row.sizeBytes).toBe(VIDEO_PART_SIZE + lastPart);
    expect(
      (await storageService.headObject(videoOriginalKey(video.id)))
        .contentLength,
    ).toBe(VIDEO_PART_SIZE + lastPart);

    const job = await queue.getJob(video.id);
    expect(job?.name).toBe(PROCESS_VIDEO_JOB);
    expect(job?.data).toEqual({ videoId: video.id });
    const counts = await queue.getJobCounts('waiting', 'delayed', 'active');
    expect(counts.waiting + counts.delayed + counts.active).toBe(1);

    await storageService.deleteObject(videoOriginalKey(video.id));
  }, 120000);

  it('should abort the multipart and remove the row', async () => {
    const { video } = await videosService.initiateUpload(userId, {
      filename: 'aula.mp4',
      contentType: 'video/mp4',
      sizeBytes: 1024,
    });
    const uploadId = (await videoRepository.findOneByOrFail({ id: video.id }))
      .upload_id!;

    await videosService.abortUpload(userId, video.public_id);

    expect(await videoRepository.findOneBy({ id: video.id })).toBeNull();
    await expect(
      storageService.listParts(videoOriginalKey(video.id), uploadId),
    ).rejects.toMatchObject({ name: 'NoSuchUpload' });
  });
});
