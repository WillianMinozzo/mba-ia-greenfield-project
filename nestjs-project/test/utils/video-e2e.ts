import * as crypto from 'crypto';
import {
  AbortMultipartUploadCommand,
  DeleteObjectsCommand,
  ListMultipartUploadsCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { DomainExceptionFilter } from '../../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../../src/common/filters/validation-exception.filter';
import { MailService } from '../../src/mail/mail.service';

export const E2E_BUCKET = 'streamtube-e2e';

// Booting AppModule connects to Postgres, MinIO and Redis, and every test logs in two users.
export const VIDEO_E2E_TIMEOUT_MS = 60000;

export interface VideoE2eContext {
  app: INestApplication<App>;
  dataSource: DataSource;
  throttlerStorage: ThrottlerStorageService;
}

/**
 * Boots the full app the way main.ts does, against real Postgres, MinIO and Redis.
 * Signed URLs are followed from inside the container (only `minio` resolves there)
 * and media goes to a dedicated bucket that `emptyE2eBucket` wipes.
 */
export async function createVideoE2eApp(): Promise<VideoE2eContext> {
  process.env.S3_PUBLIC_ENDPOINT = 'http://minio:9000';
  process.env.S3_BUCKET = E2E_BUCKET;
  process.env.QUEUE_PREFIX = `e2e-${crypto.randomUUID()}`;

  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication<INestApplication<App>>();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(
    new DomainExceptionFilter(),
    new ValidationExceptionFilter(),
  );
  await app.init();

  return {
    app,
    dataSource: moduleFixture.get(DataSource),
    throttlerStorage:
      moduleFixture.get<ThrottlerStorageService>(ThrottlerStorage),
  };
}

/** Registers, confirms and logs in a fresh user; returns its access token. */
export async function registerConfirmAndLogin(
  app: INestApplication<App>,
): Promise<string> {
  const email = `video_${crypto.randomUUID()}@example.com`;
  const password = 'password123';
  const mailService = app.get(MailService);
  let token = '';
  jest
    .spyOn(mailService, 'sendConfirmationEmail')
    .mockImplementationOnce((_e: string, _n: string, t: string) => {
      token = t;
      return Promise.resolve();
    });

  await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password });
  await request(app.getHttpServer())
    .get('/auth/confirm-email')
    .query({ token });
  const res = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email, password });
  return (res.body as { access_token: string }).access_token;
}

function s3Client(): S3Client {
  return new S3Client({
    endpoint: process.env.S3_ENDPOINT ?? 'http://minio:9000',
    region: process.env.S3_REGION ?? 'us-east-1',
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
    },
  });
}

/** Aborts pending multipart uploads and deletes every object in the e2e bucket. */
export async function emptyE2eBucket(): Promise<void> {
  const client = s3Client();
  try {
    await emptyBucket(client);
  } catch (err) {
    // The bucket only exists once the app booted; nothing to clean otherwise.
    if ((err as Error).name !== 'NoSuchBucket') throw err;
  } finally {
    client.destroy();
  }
}

async function emptyBucket(client: S3Client): Promise<void> {
  const uploads = await client.send(
    new ListMultipartUploadsCommand({ Bucket: E2E_BUCKET }),
  );
  for (const upload of uploads.Uploads ?? []) {
    await client.send(
      new AbortMultipartUploadCommand({
        Bucket: E2E_BUCKET,
        Key: upload.Key,
        UploadId: upload.UploadId,
      }),
    );
  }
  const objects = await client.send(
    new ListObjectsV2Command({ Bucket: E2E_BUCKET }),
  );
  if (objects.Contents?.length) {
    await client.send(
      new DeleteObjectsCommand({
        Bucket: E2E_BUCKET,
        Delete: { Objects: objects.Contents.map((o) => ({ Key: o.Key })) },
      }),
    );
  }
}

/** PUTs random bytes to a presigned part URL and returns the response. */
export async function putPart(url: string, size: number): Promise<Response> {
  return fetch(url, { method: 'PUT', body: crypto.randomBytes(size) });
}
