import * as crypto from 'crypto';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import { Channel } from '../channels/entities/channel.entity';
import queueConfig from '../config/queue.config';
import storageConfig from '../config/storage.config';
import { User } from '../users/entities/user.entity';
import { Video } from '../videos/entities/video.entity';
import { createTestDataSource } from './create-test-data-source';

export const VIDEO_TEST_ENTITIES = [
  User,
  Channel,
  RefreshToken,
  VerificationToken,
  Video,
];

/**
 * Bootstraps a module against the real Postgres, MinIO and Redis services.
 * Signed URLs are followed from inside the container, where only `minio` resolves,
 * and the BullMQ prefix is unique per suite so queues never collide in Redis.
 */
export async function createVideoTestingModule(
  imports: NonNullable<
    Parameters<typeof Test.createTestingModule>[0]
  >['imports'],
): Promise<TestingModule> {
  process.env.S3_PUBLIC_ENDPOINT = 'http://minio:9000';
  const module = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        load: [storageConfig, queueConfig],
      }),
      TypeOrmModule.forRoot(createTestDataSource(VIDEO_TEST_ENTITIES).options),
      BullModule.forRoot({
        connection: {
          host: process.env.REDIS_HOST ?? 'redis',
          port: Number(process.env.REDIS_PORT ?? 6379),
        },
        prefix: `test-${crypto.randomUUID()}`,
      }),
      ...(imports ?? []),
    ],
  }).compile();
  await module.init();
  return module;
}
