import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { extname } from 'path';
import { QueryFailedError, Repository } from 'typeorm';
import { ChannelsService } from '../channels/channels.service';
import {
  InvalidPartNumberException,
  UploadIncompleteException,
  UploadNotInProgressException,
  UploadSizeMismatchException,
  VideoNotFoundException,
} from '../common/exceptions/domain.exception';
import { videoOriginalKey, videoThumbnailKey } from '../storage/storage-keys';
import { StorageService, type UploadedPart } from '../storage/storage.service';
import { VideoProcessingPublisher } from '../video-processing/video-processing.publisher';
import { Video, VideoProcessingStatus } from './entities/video.entity';
import { generatePublicId } from './public-id.util';
import {
  MEDIA_URL_EXPIRATION_SECONDS,
  PUBLIC_ID_MAX_ATTEMPTS,
  VIDEO_PART_SIZE,
  VIDEO_TITLE_MAX_LENGTH,
} from './videos.constants';

const PG_UNIQUE_VIOLATION = '23505';
const PUBLIC_ID_COLUMN = 'public_id';

export interface InitiateUploadInput {
  filename: string;
  contentType: string;
  sizeBytes: number;
}

export interface InitiatedUpload {
  video: Video;
  partSize: number;
  partCount: number;
}

export interface SignedMediaUrls {
  streamUrl: string;
  downloadUrl: string;
  thumbnailUrl: string;
  expiresAt: Date;
}

export interface OwnedVideoView {
  video: Video;
  media: SignedMediaUrls | null;
}

export interface SignedPartUrl {
  partNumber: number;
  url: string;
}

function isPublicIdCollision(err: unknown): boolean {
  if (!(err instanceof QueryFailedError)) return false;
  const e = err as QueryFailedError & { code?: unknown; detail?: unknown };
  return (
    e.code === PG_UNIQUE_VIOLATION &&
    typeof e.detail === 'string' &&
    e.detail.includes(PUBLIC_ID_COLUMN)
  );
}

function titleFromFilename(filename: string): string {
  const base = filename.slice(0, filename.length - extname(filename).length);
  return (base || filename).slice(0, VIDEO_TITLE_MAX_LENGTH);
}

export function partCountFor(sizeBytes: number): number {
  return Math.ceil(sizeBytes / VIDEO_PART_SIZE);
}

@Injectable()
export class VideosService {
  constructor(
    @InjectRepository(Video)
    private readonly videoRepository: Repository<Video>,
    private readonly channelsService: ChannelsService,
    private readonly storageService: StorageService,
    private readonly publisher: VideoProcessingPublisher,
  ) {}

  async initiateUpload(
    userId: string,
    input: InitiateUploadInput,
  ): Promise<InitiatedUpload> {
    const channel = await this.channelsService.findByUserId(userId);
    if (!channel) throw new Error(`User ${userId} has no channel`);

    const video = await this.saveWithUniquePublicId(
      this.videoRepository.create({
        channel_id: channel.id,
        title: titleFromFilename(input.filename),
        original_filename: input.filename,
        content_type: input.contentType,
        sizeBytes: input.sizeBytes,
      }),
    );

    try {
      video.upload_id = await this.storageService.createMultipartUpload(
        videoOriginalKey(video.id),
        input.contentType,
      );
    } catch (err) {
      await this.videoRepository.delete({ id: video.id });
      throw err;
    }
    await this.videoRepository.update(
      { id: video.id },
      { upload_id: video.upload_id },
    );

    return {
      video,
      partSize: VIDEO_PART_SIZE,
      partCount: partCountFor(input.sizeBytes),
    };
  }

  async findOwnedByPublicId(userId: string, publicId: string): Promise<Video> {
    const video = await this.videoRepository.findOne({
      where: { public_id: publicId, channel: { user_id: userId } },
    });
    if (!video) throw new VideoNotFoundException();
    return video;
  }

  /** Owner view of a video; media URLs are signed only once processing is ready. */
  async getOwnedVideo(
    userId: string,
    publicId: string,
  ): Promise<OwnedVideoView> {
    const video = await this.findOwnedByPublicId(userId, publicId);
    if (video.processingStatus !== VideoProcessingStatus.READY) {
      return { video, media: null };
    }

    const expiresIn = MEDIA_URL_EXPIRATION_SECONDS;
    const original = videoOriginalKey(video.id);
    const [streamUrl, downloadUrl, thumbnailUrl] = await Promise.all([
      this.storageService.presignGetObject(original, { expiresIn }),
      this.storageService.presignGetObject(original, {
        expiresIn,
        downloadFilename: video.original_filename,
      }),
      this.storageService.presignGetObject(videoThumbnailKey(video.id), {
        expiresIn,
      }),
    ]);
    return {
      video,
      media: {
        streamUrl,
        downloadUrl,
        thumbnailUrl,
        expiresAt: new Date(Date.now() + expiresIn * 1000),
      },
    };
  }

  async signPartUrls(
    userId: string,
    publicId: string,
    partNumbers: number[],
  ): Promise<SignedPartUrl[]> {
    const video = await this.findAwaitingUpload(userId, publicId);
    const partCount = partCountFor(video.sizeBytes);
    if (partNumbers.some((n) => n < 1 || n > partCount)) {
      throw new InvalidPartNumberException(partCount);
    }

    const key = videoOriginalKey(video.id);
    return Promise.all(
      partNumbers.map(async (partNumber) => ({
        partNumber,
        url: await this.storageService.presignUploadPart(
          key,
          video.upload_id!,
          partNumber,
        ),
      })),
    );
  }

  async listUploadedParts(
    userId: string,
    publicId: string,
  ): Promise<UploadedPart[]> {
    const video = await this.findAwaitingUpload(userId, publicId);
    return this.storageService.listParts(
      videoOriginalKey(video.id),
      video.upload_id!,
    );
  }

  async abortUpload(userId: string, publicId: string): Promise<void> {
    const video = await this.findAwaitingUpload(userId, publicId);
    await this.storageService.abortMultipartUpload(
      videoOriginalKey(video.id),
      video.upload_id!,
    );
    await this.videoRepository.delete({ id: video.id });
  }

  /**
   * Completes the multipart upload and triggers processing. Idempotent: a video that
   * already left awaiting_upload is returned as-is, without a new job.
   */
  async completeUpload(userId: string, publicId: string): Promise<Video> {
    const video = await this.findOwnedByPublicId(userId, publicId);
    if (
      video.processingStatus !== VideoProcessingStatus.AWAITING_UPLOAD ||
      !video.upload_id
    ) {
      return video;
    }

    const key = videoOriginalKey(video.id);
    const partCount = partCountFor(video.sizeBytes);
    const parts = await this.storageService.listParts(key, video.upload_id);
    if (parts.length < partCount) {
      throw new UploadIncompleteException(parts.length, partCount);
    }

    await this.storageService.completeMultipartUpload(
      key,
      video.upload_id,
      parts,
    );
    const { contentLength } = await this.storageService.headObject(key);

    if (contentLength !== video.sizeBytes) {
      const error = new UploadSizeMismatchException(
        contentLength,
        video.sizeBytes,
      );
      await this.storageService.deleteObject(key);
      await this.videoRepository.update(
        { id: video.id },
        {
          processingStatus: VideoProcessingStatus.FAILED,
          processingError: `${error.errorCode}: ${error.message}`,
          upload_id: null,
        },
      );
      throw error;
    }

    Object.assign(video, {
      processingStatus: VideoProcessingStatus.PROCESSING,
      upload_id: null,
      sizeBytes: contentLength,
    });
    await this.videoRepository.update(
      { id: video.id },
      {
        processingStatus: video.processingStatus,
        upload_id: null,
        sizeBytes: contentLength,
      },
    );
    // Only after the status change is committed: the worker must find the video in processing.
    await this.publisher.enqueue(video.id);
    return video;
  }

  private async findAwaitingUpload(
    userId: string,
    publicId: string,
  ): Promise<Video> {
    const video = await this.findOwnedByPublicId(userId, publicId);
    if (
      video.processingStatus !== VideoProcessingStatus.AWAITING_UPLOAD ||
      !video.upload_id
    ) {
      throw new UploadNotInProgressException();
    }
    return video;
  }

  private async saveWithUniquePublicId(video: Video): Promise<Video> {
    for (let attempt = 1; ; attempt++) {
      video.public_id = generatePublicId();
      try {
        return await this.videoRepository.save(video);
      } catch (err) {
        if (!isPublicIdCollision(err) || attempt >= PUBLIC_ID_MAX_ATTEMPTS) {
          throw err;
        }
      }
    }
  }
}
