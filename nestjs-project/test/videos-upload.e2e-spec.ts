import { INestApplication } from '@nestjs/common';
import { ThrottlerStorageService } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { Video } from '../src/videos/entities/video.entity';
import { cleanAllTables } from '../src/test/create-test-data-source';
import {
  createVideoE2eApp,
  emptyE2eBucket,
  putPart,
  registerConfirmAndLogin,
  VIDEO_E2E_TIMEOUT_MS,
} from './utils/video-e2e';

jest.setTimeout(VIDEO_E2E_TIMEOUT_MS);

interface UploadBody {
  id: string;
  publicId: string;
  title: string;
  processingStatus: string;
  publicationStatus: string;
  partSize: number;
  partCount: number;
}

interface ErrorBody {
  error: string;
  message: string | string[];
}

interface PartUrlsBody {
  parts: { partNumber: number; url: string }[];
  expiresAt: string;
}

interface PartsBody {
  parts: { partNumber: number; sizeBytes: number; etag: string }[];
}

const validBody = {
  filename: 'aula.mp4',
  contentType: 'video/mp4',
  sizeBytes: 15728640,
};

describe('videos-upload', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let throttlerStorage: ThrottlerStorageService;
  let ownerToken: string;
  let otherToken: string;

  beforeAll(async () => {
    ({ app, dataSource, throttlerStorage } = await createVideoE2eApp());
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

  async function preRegister(sizeBytes = 1024): Promise<UploadBody> {
    const res = await http()
      .post('/videos')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ ...validBody, sizeBytes })
      .expect(201);
    return res.body as UploadBody;
  }

  async function partUrl(publicId: string, partNumber = 1): Promise<string> {
    const res = await http()
      .get(`/videos/${publicId}/upload/part-urls`)
      .query({ partNumbers: String(partNumber) })
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    return (res.body as PartUrlsBody).parts[0].url;
  }

  const videoCount = () => dataSource.getRepository(Video).count();

  // 1. Pré-cadastrar vídeo — POST /videos

  test('pre-cadastro-retorna-rascunho-aguardando-upload', async () => {
    const res = await http()
      .post('/videos')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(validBody)
      .expect(201);
    const body = res.body as UploadBody;

    expect(body.publicId).toMatch(/^[A-Za-z0-9_-]{11}$/);
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body).toMatchObject({
      title: 'aula',
      processingStatus: 'awaiting_upload',
      publicationStatus: 'draft',
      partSize: 67108864,
      partCount: 1,
    });

    const [row] = await dataSource.query<
      { upload_id: string | null; user_id: string }[]
    >(
      `SELECT v.upload_id, c.user_id FROM videos v
       JOIN channels c ON c.id = v.channel_id WHERE v.id = $1`,
      [body.id],
    );
    expect(row.upload_id).toBeTruthy();
    const me = await http()
      .get('/auth/me')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(row.user_id).toBe((me.body as { sub: string }).sub);
  });

  test('pre-cadastro-rejeita-body-invalido', async () => {
    const png = await http()
      .post('/videos')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ ...validBody, contentType: 'image/png' })
      .expect(400);
    expect((png.body as ErrorBody).error).toBe('VALIDATION_ERROR');
    expect(Array.isArray((png.body as ErrorBody).message)).toBe(true);

    const tooBig = await http()
      .post('/videos')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ ...validBody, sizeBytes: 10737418241 })
      .expect(400);
    expect((tooBig.body as ErrorBody).error).toBe('VALIDATION_ERROR');

    expect(await videoCount()).toBe(0);
  });

  test('pre-cadastro-exige-autenticacao', async () => {
    await http().post('/videos').send(validBody).expect(401);

    expect(await videoCount()).toBe(0);
  });

  // 2. Enviar partes e consultar o progresso — part-urls e parts

  test('part-url-assinada-aceita-put-direto-no-storage', async () => {
    const { publicId } = await preRegister();

    const res = await http()
      .get(`/videos/${publicId}/upload/part-urls`)
      .query({ partNumbers: '1' })
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    const body = res.body as PartUrlsBody;
    expect(body.parts).toHaveLength(1);
    expect(body.parts[0].partNumber).toBe(1);
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());

    const put = await putPart(body.parts[0].url, 1024);
    expect(put.status).toBe(200);
    expect(put.headers.get('etag')).toBeTruthy();
  });

  test('lista-partes-recebidas-apos-put', async () => {
    const { publicId } = await preRegister();
    const put = await putPart(await partUrl(publicId), 1024);

    const res = await http()
      .get(`/videos/${publicId}/upload/parts`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    expect((res.body as PartsBody).parts).toEqual([
      { partNumber: 1, sizeBytes: 1024, etag: put.headers.get('etag') },
    ]);
  });

  test('part-number-fora-do-intervalo-rejeitado', async () => {
    const { publicId } = await preRegister();

    const res = await http()
      .get(`/videos/${publicId}/upload/part-urls`)
      .query({ partNumbers: '2' })
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(400);

    expect((res.body as ErrorBody).error).toBe('INVALID_PART_NUMBER');
  });

  test('part-urls-rejeita-query-invalida', async () => {
    const { publicId } = await preRegister();

    const missing = await http()
      .get(`/videos/${publicId}/upload/part-urls`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(400);
    expect((missing.body as ErrorBody).error).toBe('VALIDATION_ERROR');

    const malformed = await http()
      .get(`/videos/${publicId}/upload/part-urls`)
      .query({ partNumbers: 'abc' })
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(400);
    expect((malformed.body as ErrorBody).error).toBe('VALIDATION_ERROR');
  });

  // 3. Isolamento por dono e publicId malformado

  test('outro-usuario-recebe-404-em-rotas-com-publicid', async () => {
    const { id, publicId } = await preRegister();
    const auth = `Bearer ${otherToken}`;

    const responses = await Promise.all([
      http()
        .get(`/videos/${publicId}/upload/part-urls`)
        .query({ partNumbers: '1' })
        .set('Authorization', auth),
      http().get(`/videos/${publicId}/upload/parts`).set('Authorization', auth),
      http().delete(`/videos/${publicId}/upload`).set('Authorization', auth),
    ]);
    for (const res of responses) {
      expect(res.status).toBe(404);
      expect((res.body as ErrorBody).error).toBe('VIDEO_NOT_FOUND');
    }

    const video = await dataSource.getRepository(Video).findOneBy({ id });
    expect(video?.processingStatus).toBe('awaiting_upload');
  });

  test('publicid-malformado-recebe-404', async () => {
    for (const publicId of ['abc', 'dQw4w9WgXc!']) {
      const res = await http()
        .get(`/videos/${encodeURIComponent(publicId)}/upload/parts`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(404);
      expect((res.body as ErrorBody).error).toBe('VIDEO_NOT_FOUND');
    }
  });

  test('rotas-com-publicid-exigem-autenticacao', async () => {
    const { publicId } = await preRegister();

    await http().get(`/videos/${publicId}/upload/parts`).expect(401);
  });

  // 4. Cancelar upload — DELETE /videos/:publicId/upload

  test('cancelar-remove-pre-cadastro', async () => {
    const { id, publicId } = await preRegister();

    const res = await http()
      .delete(`/videos/${publicId}/upload`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(204);
    expect(res.text).toBe('');
    expect(await dataSource.getRepository(Video).findOneBy({ id })).toBeNull();

    const after = await http()
      .get(`/videos/${publicId}/upload/parts`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(404);
    expect((after.body as ErrorBody).error).toBe('VIDEO_NOT_FOUND');
  });
});
