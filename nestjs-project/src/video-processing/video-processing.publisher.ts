import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import {
  PROCESS_VIDEO_JOB,
  VIDEO_PROCESSING_QUEUE,
  type ProcessVideoJobData,
} from './video-processing.constants';

const PENDING_STATES = ['waiting', 'active', 'delayed'];

@Injectable()
export class VideoProcessingPublisher {
  constructor(
    @InjectQueue(VIDEO_PROCESSING_QUEUE)
    private readonly queue: Queue<ProcessVideoJobData>,
  ) {}

  // jobId = videoId deduplicates: a second add is ignored while the job still exists.
  async enqueue(videoId: string): Promise<void> {
    await this.queue.add(PROCESS_VIDEO_JOB, { videoId }, { jobId: videoId });
  }

  async hasPendingJob(videoId: string): Promise<boolean> {
    const job = await this.queue.getJob(videoId);
    if (!job) return false;
    return PENDING_STATES.includes(await job.getState());
  }

  /**
   * Enqueues the video unless a job is already pending. A retained completed/failed job
   * with the same id would make `add` a silent no-op, so it is removed first.
   * Returns whether a new job was added.
   */
  async requeue(videoId: string): Promise<boolean> {
    if (await this.hasPendingJob(videoId)) return false;
    await this.queue.remove(videoId);
    await this.enqueue(videoId);
    return true;
  }
}
