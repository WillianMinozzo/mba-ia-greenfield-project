import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Video, VideoProcessingStatus } from '../videos/entities/video.entity';
import { VideoProcessingPublisher } from './video-processing.publisher';

/**
 * Closes the gap between the API committing `processing` and publishing the job:
 * on worker boot, every `processing` video without a pending job is enqueued again.
 */
@Injectable()
export class VideoProcessingReconciler implements OnApplicationBootstrap {
  private readonly logger = new Logger(VideoProcessingReconciler.name);

  constructor(
    @InjectRepository(Video)
    private readonly videoRepository: Repository<Video>,
    private readonly publisher: VideoProcessingPublisher,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.reconcile();
  }

  async reconcile(): Promise<number> {
    const videos = await this.videoRepository.find({
      select: { id: true },
      where: { processingStatus: VideoProcessingStatus.PROCESSING },
    });

    let requeued = 0;
    for (const { id } of videos) {
      if (await this.publisher.requeue(id)) requeued++;
    }
    if (requeued > 0) {
      this.logger.log(`Re-enqueued ${requeued} video(s) stuck in processing`);
    }
    return requeued;
  }
}
