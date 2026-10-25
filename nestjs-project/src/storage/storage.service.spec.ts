import { S3Client } from '@aws-sdk/client-s3';
import type { ConfigType } from '@nestjs/config';
import type storageConfig from '../config/storage.config';
import { StorageService } from './storage.service';

const config: ConfigType<typeof storageConfig> = {
  endpoint: 'http://minio:9000',
  publicEndpoint: 'http://localhost:9000',
  region: 'us-east-1',
  accessKeyId: 'access-key',
  secretAccessKey: 'secret-key',
  bucket: 'test-bucket',
  forcePathStyle: true,
};

const client = (endpoint: string): S3Client =>
  new S3Client({
    endpoint,
    region: config.region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });

describe('StorageService (signing)', () => {
  let service: StorageService;

  beforeEach(() => {
    service = new StorageService(
      client(config.endpoint),
      client(config.publicEndpoint),
      config,
    );
  });

  it('should sign presignGetObject URLs with the public endpoint host', async () => {
    const url = new URL(
      await service.presignGetObject('videos/abc/original', {
        expiresIn: 14400,
      }),
    );

    expect(url.host).toBe('localhost:9000');
    expect(url.pathname).toBe('/test-bucket/videos/abc/original');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('14400');
    expect(url.searchParams.has('response-content-disposition')).toBe(false);
  });

  it('should add response-content-disposition only when downloadFilename is given', async () => {
    const url = new URL(
      await service.presignGetObject('videos/abc/original', {
        expiresIn: 14400,
        downloadFilename: 'aula.mp4',
      }),
    );

    expect(url.searchParams.get('response-content-disposition')).toBe(
      'attachment; filename="aula.mp4"',
    );
  });

  it('should sign presignUploadPart URLs with the public endpoint host and part number', async () => {
    const url = new URL(
      await service.presignUploadPart('videos/abc/original', 'upload-1', 2),
    );

    expect(url.host).toBe('localhost:9000');
    expect(url.searchParams.get('partNumber')).toBe('2');
    expect(url.searchParams.get('uploadId')).toBe('upload-1');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('3600');
  });

  it('should sign presignInternalGetObject URLs with the internal endpoint host', async () => {
    const url = new URL(
      await service.presignInternalGetObject('videos/abc/original'),
    );

    expect(url.host).toBe('minio:9000');
  });
});
