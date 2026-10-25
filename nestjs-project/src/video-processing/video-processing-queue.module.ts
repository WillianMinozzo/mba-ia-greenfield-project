import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import {
  VIDEO_PROCESSING_JOB_OPTIONS,
  VIDEO_PROCESSING_QUEUE,
} from './video-processing.constants';
import { VideoProcessingPublisher } from './video-processing.publisher';

// Registers the queue without a processor: importers only publish. The processor lives in WorkerModule.
@Module({
  imports: [
    BullModule.registerQueue({
      name: VIDEO_PROCESSING_QUEUE,
      defaultJobOptions: VIDEO_PROCESSING_JOB_OPTIONS,
    }),
  ],
  providers: [VideoProcessingPublisher],
  exports: [VideoProcessingPublisher],
})
export class VideoProcessingQueueModule {}
