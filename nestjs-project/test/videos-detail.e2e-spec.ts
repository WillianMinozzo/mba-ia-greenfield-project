import * as crypto from 'crypto';
import { INestApplication } from '@nestjs/common';
import { ThrottlerStorageService } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import {
  videoOriginalKey,
  videoThumbnailKey,
} from '../src/storage/storage-keys';
import { StorageService } from '../src/storage/storage.service';
import { cleanAllTables } from '../src/test/create-test-data-source';
import {
  Video,
  VideoProcessingStatus,
} from '../src/videos/entities/video.entity';
import {
  createVideoE2eApp,
  emptyE2eBucket,
  registerConfirmAndLogin,
  VIDEO_E2E_TIMEOUT_MS,
} from './utils/video-e2e';

jest.setTimeout(VIDEO_E2E_TIMEOUT_MS);

interface VideoBody {
  publicId: string;
  processingStatus: string;
  publicationStatus: string;
  originalFilename: string;
  contentType: string;
  sizeBytes: number;
  processingError: string | null;
  processedAt: string | null;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  videoCodec: string | null;
  formatName: string | null;
  bitrate: number | null;
  frameRate: number | null;
  streamUrl: string | null;
  downloadUrl: string | null;
  thumbnailUrl: string | null;
  urlsExpireAt: string | null;
}

const ORIGINAL_BYTES = 4096;
const HOUR_MS = 3600 * 1000;

describe('videos-detail', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let throttlerStorage: ThrottlerStorageService;
  let storage: StorageService;
  let ownerToken: string;
  let otherToken: string;

  beforeAll(async () => {
    ({ app, dataSource, throttlerStorage } = await createVideoE2eApp());
    storage = app.get(StorageService);
  });

  afterAll(async () => {
    await emptyE2eBucket();
    await app.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    throttlerStorage.storage.clear();
    ownerToken = await registerConfirmAndLogin(app);
    otherToken = await registerConfirmAndLogin(app);
  });

  const http = () => request(app.getHttpServer());

  async function preRegister(): Promise<{ id: string; publicId: string }> {
    const res = await http()
      .post('/videos')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        filename: 'aula.mp4',
        contentType: 'video/mp4',
        sizeBytes: ORIGINAL_BYTES,
      })
      .expect(201);
    return res.body as { id: string; publicId: string };
  }

  const getDetail = (publicId: string, token = ownerToken) =>
    http().get(`/videos/${publicId}`).set('Authorization', `Bearer ${token}`);

  const updateVideo = (id: string, changes: Partial<Video>) =>
    dataSource.getRepository(Video).update({ id }, changes);

  /** Arranges a ready video without the worker: media in the bucket + metrics in the row. */
  async function arrangeReadyVideo(): Promise<string> {
    const { id, publicId } = await preRegister();
    await storage.putObject(
      videoOriginalKey(id),
      crypto.randomBytes(ORIGINAL_BYTES),
      'video/mp4',
    );
    await storage.putObject(
      videoThumbnailKey(id),
      crypto.randomBytes(512),
      'image/jpeg',
    );
    await updateVideo(id, {
      processingStatus: VideoProcessingStatus.READY,
      upload_id: null,
      processedAt: new Date(),
      durationSeconds: 2.04,
      width: 320,
      height: 240,
      videoCodec: 'h264',
      formatName: 'mov,mp4,m4a,3gp,3g2,mj2',
      bitrate: 128000,
      frameRate: 25,
    });
    return publicId;
  }

  // 1. Detalhe antes do processamento concluir

  test('detalhe-sem-urls-fora-de-ready', async () => {
    const { id, publicId } = await preRegister();

    const awaiting = (await getDetail(publicId).expect(200)).body as VideoBody;
    expect(awaiting).toMatchObject({
      processingStatus: 'awaiting_upload',
      publicationStatus: 'draft',
      originalFilename: 'aula.mp4',
      contentType: 'video/mp4',
      sizeBytes: ORIGINAL_BYTES,
      streamUrl: null,
      downloadUrl: null,
      thumbnailUrl: null,
      urlsExpireAt: null,
    });

    await updateVideo(id, {
      processingStatus: VideoProcessingStatus.PROCESSING,
    });
    const processing = (await getDetail(publicId).expect(200))
      .body as VideoBody;
    expect(processing).toMatchObject({
      processingStatus: 'processing',
      streamUrl: null,
      downloadUrl: null,
      thumbnailUrl: null,
    });
  });

  // 2. Detalhe de vídeo pronto — URLs assinadas

  test('detalhe-ready-com-urls-e-metadados', async () => {
    const publicId = await arrangeReadyVideo();

    const body = (await getDetail(publicId).expect(200)).body as VideoBody;

    expect(body.processingStatus).toBe('ready');
    for (const url of [body.streamUrl, body.downloadUrl, body.thumbnailUrl]) {
      expect(typeof url).toBe('string');
      expect(url).not.toBe('');
    }
    const ttl = new Date(body.urlsExpireAt!).getTime() - Date.now();
    expect(ttl).toBeGreaterThan(4 * HOUR_MS - 5 * 60 * 1000);
    expect(ttl).toBeLessThan(4 * HOUR_MS + 5 * 60 * 1000);
    expect(body).toMatchObject({
      durationSeconds: 2.04,
      width: 320,
      height: 240,
      videoCodec: 'h264',
      formatName: 'mov,mp4,m4a,3gp,3g2,mj2',
      bitrate: 128000,
      frameRate: 25,
    });
    expect(new Date(body.processedAt!).toISOString()).toBe(body.processedAt);
  });

  test('stream-url-responde-206-com-range', async () => {
    const publicId = await arrangeReadyVideo();
    const { streamUrl } = (await getDetail(publicId).expect(200))
      .body as VideoBody;

    const res = await fetch(streamUrl!, {
      headers: { Range: 'bytes=0-1023' },
    });

    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toMatch(/^bytes 0-1023\//);
    expect((await res.arrayBuffer()).byteLength).toBe(1024);
  });

  test('download-url-forca-attachment-com-nome-original', async () => {
    const publicId = await arrangeReadyVideo();
    const { downloadUrl } = (await getDetail(publicId).expect(200))
      .body as VideoBody;

    const res = await fetch(downloadUrl!);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toBe(
      'attachment; filename="aula.mp4"',
    );
  });

  // 3. Autorização e falha de processamento

  test('detalhe-por-outro-usuario-ou-sem-token', async () => {
    const { publicId } = await preRegister();

    const res = await getDetail(publicId, otherToken).expect(404);
    expect((res.body as { error: string }).error).toBe('VIDEO_NOT_FOUND');

    await http().get(`/videos/${publicId}`).expect(401);
  });

  test('detalhe-failed-expoe-processing-error', async () => {
    const { id, publicId } = await preRegister();
    await updateVideo(id, {
      processingStatus: VideoProcessingStatus.FAILED,
      processingError: 'MEDIA_INVALID: no video stream',
    });

    const body = (await getDetail(publicId).expect(200)).body as VideoBody;

    expect(body).toMatchObject({
      processingStatus: 'failed',
      processingError: 'MEDIA_INVALID: no video stream',
      streamUrl: null,
      downloadUrl: null,
      thumbnailUrl: null,
    });
  });
});
