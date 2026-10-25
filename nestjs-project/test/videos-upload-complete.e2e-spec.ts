import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication } from '@nestjs/common';
import { ThrottlerStorageService } from '@nestjs/throttler';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { videoOriginalKey } from '../src/storage/storage-keys';
import { StorageService } from '../src/storage/storage.service';
import { cleanAllTables } from '../src/test/create-test-data-source';
import {
  PROCESS_VIDEO_JOB,
  VIDEO_PROCESSING_QUEUE,
} from '../src/video-processing/video-processing.constants';
import { Video } from '../src/videos/entities/video.entity';
import {
  createVideoE2eApp,
  emptyE2eBucket,
  putPart,
  registerConfirmAndLogin,
  VIDEO_E2E_TIMEOUT_MS,
} from './utils/video-e2e';

jest.setTimeout(VIDEO_E2E_TIMEOUT_MS);

interface CreatedBody {
  id: string;
  publicId: string;
}

interface CompleteBody {
  id: string;
  publicId: string;
  processingStatus: string;
}

interface ErrorBody {
  error: string;
}

const PART_SIZE = 67108864;

describe('videos-upload-complete', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let throttlerStorage: ThrottlerStorageService;
  let queue: Queue;
  let storage: StorageService;
  let ownerToken: string;
  let otherToken: string;

  beforeAll(async () => {
    ({ app, dataSource, throttlerStorage } = await createVideoE2eApp());
    queue = app.get<Queue>(getQueueToken(VIDEO_PROCESSING_QUEUE));
    storage = app.get(StorageService);
  });

  afterAll(async () => {
    await queue.obliterate({ force: true });
    await emptyE2eBucket();
    await app.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    throttlerStorage.storage.clear();
    await queue.obliterate({ force: true });
    ownerToken = await registerConfirmAndLogin(app);
    otherToken = await registerConfirmAndLogin(app);
  });

  const http = () => request(app.getHttpServer());

  /** Pre-registers a video declaring `sizeBytes` and PUTs `bytesPerPart[i]` into part i+1. */
  async function uploadVideo(
    sizeBytes: number,
    bytesPerPart: number[],
  ): Promise<CreatedBody> {
    const created = await http()
      .post('/videos')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ filename: 'aula.mp4', contentType: 'video/mp4', sizeBytes })
      .expect(201);
    const { publicId } = created.body as CreatedBody;

    for (const [index, size] of bytesPerPart.entries()) {
      const urls = await http()
        .get(`/videos/${publicId}/upload/part-urls`)
        .query({ partNumbers: String(index + 1) })
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      const { url } = (urls.body as { parts: { url: string }[] }).parts[0];
      expect((await putPart(url, size)).status).toBe(200);
    }
    return created.body as CreatedBody;
  }

  const complete = (publicId: string, token = ownerToken) =>
    http()
      .post(`/videos/${publicId}/upload/complete`)
      .set('Authorization', `Bearer ${token}`);

  async function pendingJobCount(): Promise<number> {
    const counts = await queue.getJobCounts('waiting', 'delayed', 'active');
    return counts.waiting + counts.delayed + counts.active;
  }

  const findVideo = (id: string) =>
    dataSource.getRepository(Video).findOneByOrFail({ id });

  // 1. Concluir upload e enfileirar process-video

  test('complete-retorna-202-e-publica-job', async () => {
    const { id, publicId } = await uploadVideo(1024, [1024]);

    const res = await complete(publicId).expect(202);

    expect(res.body as CompleteBody).toEqual({
      id,
      publicId,
      processingStatus: 'processing',
    });
    const job = await queue.getJob(id);
    expect(job?.name).toBe(PROCESS_VIDEO_JOB);
    expect(job?.data).toEqual({ videoId: id });
    expect(job?.id).toBe(id);

    const video = await findVideo(id);
    expect(video.upload_id).toBeNull();
    expect(video.sizeBytes).toBe(1024);
    expect((await storage.headObject(videoOriginalKey(id))).contentLength).toBe(
      1024,
    );
  });

  test('complete-repetido-e-idempotente', async () => {
    const { publicId } = await uploadVideo(1024, [1024]);
    await complete(publicId).expect(202);

    const res = await complete(publicId).expect(202);

    expect((res.body as CompleteBody).processingStatus).toBe('processing');
    expect(await pendingJobCount()).toBe(1);
  });

  // 2. Upload incompleto ou com tamanho divergente

  test('partes-faltando-retorna-409-e-upload-segue-retomavel', async () => {
    const { id, publicId } = await uploadVideo(PART_SIZE + 1024, [1024]);

    const res = await complete(publicId).expect(409);

    expect((res.body as ErrorBody).error).toBe('UPLOAD_INCOMPLETE');
    const video = await findVideo(id);
    expect(video.processingStatus).toBe('awaiting_upload');
    expect(video.upload_id).toBeTruthy();
    expect(await pendingJobCount()).toBe(0);

    const parts = await http()
      .get(`/videos/${publicId}/upload/parts`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(
      (parts.body as { parts: { partNumber: number }[] }).parts.map(
        (p) => p.partNumber,
      ),
    ).toEqual([1]);
  });

  test('tamanho-divergente-retorna-409-e-marca-failed', async () => {
    const { id, publicId } = await uploadVideo(2048, [1024]);

    const res = await complete(publicId).expect(409);

    expect((res.body as ErrorBody).error).toBe('UPLOAD_SIZE_MISMATCH');
    const video = await findVideo(id);
    expect(video.processingStatus).toBe('failed');
    expect(video.processingError).toMatch(/^UPLOAD_SIZE_MISMATCH/);
    await expect(
      storage.headObject(videoOriginalKey(id)),
    ).rejects.toMatchObject({ name: 'NotFound' });
    expect(await pendingJobCount()).toBe(0);
  });

  // 3. Autorização

  test('complete-por-outro-usuario-ou-sem-token', async () => {
    const { id, publicId } = await uploadVideo(1024, [1024]);

    const res = await complete(publicId, otherToken).expect(404);
    expect((res.body as ErrorBody).error).toBe('VIDEO_NOT_FOUND');

    await http().post(`/videos/${publicId}/upload/complete`).expect(401);

    expect((await findVideo(id)).processingStatus).toBe('awaiting_upload');
    expect(await pendingJobCount()).toBe(0);
  });
});
