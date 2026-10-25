import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Channel } from '../channels/entities/channel.entity';
import { CONFIG_MODULE_OPTIONS } from '../config/config-module.options';
import { TYPEORM_MODULE_OPTIONS } from '../database/typeorm-module.options';
import { QueueModule } from '../queue/queue.module';
import { StorageModule } from '../storage/storage.module';
import { User } from '../users/entities/user.entity';
import { Video } from '../videos/entities/video.entity';
import { FfmpegRunner } from './media/ffmpeg-runner';
import { MediaProbeService } from './media/media-probe.service';
import { ThumbnailService } from './media/thumbnail.service';
import { VideoProcessingQueueModule } from './video-processing-queue.module';
import { VideoProcessingProcessor } from './video-processing.processor';
import { VideoProcessingReconciler } from './video-processing.reconciler';

// Root module of the video-worker process: no controllers, and the only module that declares the processor.
@Module({
  imports: [
    ConfigModule.forRoot(CONFIG_MODULE_OPTIONS),
    TypeOrmModule.forRootAsync(TYPEORM_MODULE_OPTIONS),
    // Channel and User are registered only so Video's relation metadata resolves.
    TypeOrmModule.forFeature([Video, Channel, User]),
    QueueModule,
    VideoProcessingQueueModule,
    StorageModule,
  ],
  providers: [
    FfmpegRunner,
    MediaProbeService,
    ThumbnailService,
    VideoProcessingProcessor,
    VideoProcessingReconciler,
  ],
})
export class WorkerModule {}
