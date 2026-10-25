import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './video-processing/worker.module';

// video-worker entrypoint: an application context only — no HTTP server.
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();
}
void bootstrap();
