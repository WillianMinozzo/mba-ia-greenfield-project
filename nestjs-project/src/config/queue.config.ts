import { registerAs } from '@nestjs/config';

export default registerAs('queue', () => ({
  host: process.env.REDIS_HOST || 'redis',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  // BullMQ key namespace; e2e suites override it so they never share jobs with video-worker.
  prefix: process.env.QUEUE_PREFIX || 'bull',
}));
