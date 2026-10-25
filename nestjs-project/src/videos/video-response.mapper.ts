import type { VideoResponseDto } from './dto/video-response.dto';
import type { Video } from './entities/video.entity';
import type { SignedMediaUrls } from './videos.service';

export function toVideoResponse(
  video: Video,
  media: SignedMediaUrls | null,
): VideoResponseDto {
  return {
    id: video.id,
    publicId: video.public_id,
    title: video.title,
    originalFilename: video.original_filename,
    contentType: video.content_type,
    sizeBytes: video.sizeBytes,
    processingStatus: video.processingStatus,
    publicationStatus: video.publicationStatus,
    processingError: video.processingError,
    processedAt: video.processedAt?.toISOString() ?? null,
    durationSeconds: video.durationSeconds,
    width: video.width,
    height: video.height,
    videoCodec: video.videoCodec,
    audioCodec: video.audioCodec,
    formatName: video.formatName,
    bitrate: video.bitrate,
    frameRate: video.frameRate,
    streamUrl: media?.streamUrl ?? null,
    downloadUrl: media?.downloadUrl ?? null,
    thumbnailUrl: media?.thumbnailUrl ?? null,
    urlsExpireAt: media?.expiresAt.toISOString() ?? null,
    createdAt: video.created_at.toISOString(),
  };
}
