import * as crypto from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import storageConfig from '../config/storage.config';
import { StorageModule } from './storage.module';
import { StorageService } from './storage.service';

const MIB = 1024 * 1024;

describe('StorageService (integration)', () => {
  let module: TestingModule;
  let storage: StorageService;
  const keyPrefix = `test/storage-${crypto.randomUUID()}`;

  beforeAll(async () => {
    // Signed URLs are followed from inside the container, where only `minio` resolves.
    process.env.S3_PUBLIC_ENDPOINT = 'http://minio:9000';
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [storageConfig] }),
        StorageModule,
      ],
    }).compile();
    await module.init();
    storage = module.get(StorageService);
  });

  afterAll(async () => {
    await module.close();
  });

  it('should treat ensureBucket as idempotent', async () => {
    await expect(storage.ensureBucket()).resolves.toBeUndefined();
    await expect(storage.ensureBucket()).resolves.toBeUndefined();
  });

  it('should complete a 3-part multipart uploaded through presigned part URLs', async () => {
    const key = `${keyPrefix}/multipart`;
    const sizes = [5 * MIB, 5 * MIB, 1024];
    const uploadId = await storage.createMultipartUpload(key, 'video/mp4');

    try {
      const etags: string[] = [];
      for (const [index, size] of sizes.entries()) {
        const url = await storage.presignUploadPart(key, uploadId, index + 1);
        const res = await fetch(url, {
          method: 'PUT',
          body: crypto.randomBytes(size),
        });
        expect(res.status).toBe(200);
        etags.push(res.headers.get('etag') ?? '');
      }

      const parts = await storage.listParts(key, uploadId);
      expect(parts.map((p) => [p.partNumber, p.sizeBytes])).toEqual([
        [1, 5 * MIB],
        [2, 5 * MIB],
        [3, 1024],
      ]);
      expect(parts.map((p) => p.etag)).toEqual(etags);

      // Out of order on purpose: the service must sort by part number.
      await storage.completeMultipartUpload(
        key,
        uploadId,
        [...parts].reverse(),
      );

      const head = await storage.headObject(key);
      expect(head.contentLength).toBe(sizes.reduce((a, b) => a + b, 0));
      expect(head.contentType).toBe('video/mp4');
    } finally {
      await storage.deleteObject(key);
    }
  }, 60000);

  it('should reject anonymous reads and serve attachment disposition on signed download URLs', async () => {
    const key = `${keyPrefix}/download`;
    await storage.putObject(key, Buffer.from('hello'), 'video/mp4');

    try {
      const anonymous = await fetch(
        `http://minio:9000/streamtube-media/${key}`,
      );
      expect(anonymous.status).toBe(403);

      const signed = await fetch(
        await storage.presignGetObject(key, {
          expiresIn: 60,
          downloadFilename: 'aula.mp4',
        }),
      );
      expect(signed.status).toBe(200);
      expect(signed.headers.get('content-disposition')).toBe(
        'attachment; filename="aula.mp4"',
      );
    } finally {
      await storage.deleteObject(key);
    }
  });

  it('should list no parts after a multipart upload is aborted', async () => {
    const key = `${keyPrefix}/aborted`;
    const uploadId = await storage.createMultipartUpload(key, 'video/mp4');
    await storage.abortMultipartUpload(key, uploadId);

    await expect(storage.listParts(key, uploadId)).rejects.toThrow();
  });
});
