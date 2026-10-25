export const VIDEO_PROCESSING_QUEUE = 'video-processing';
export const PROCESS_VIDEO_JOB = 'process-video';

export interface ProcessVideoJobData {
  videoId: string;
}

export const VIDEO_PROCESSING_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 30000 },
  removeOnComplete: true,
  removeOnFail: 1000,
} as const;
