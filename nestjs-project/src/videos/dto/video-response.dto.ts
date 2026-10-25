import { ApiProperty } from '@nestjs/swagger';
import {
  VideoProcessingStatus,
  VideoPublicationStatus,
} from '../entities/video.entity';

export class VideoResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'dQw4w9WgXcQ', minLength: 11, maxLength: 11 })
  publicId: string;

  @ApiProperty({ example: 'aula' })
  title: string;

  @ApiProperty({ example: 'aula.mp4' })
  originalFilename: string;

  @ApiProperty({ example: 'video/mp4' })
  contentType: string;

  @ApiProperty({ example: 15728640 })
  sizeBytes: number;

  @ApiProperty({ enum: VideoProcessingStatus })
  processingStatus: VideoProcessingStatus;

  @ApiProperty({ enum: VideoPublicationStatus })
  publicationStatus: VideoPublicationStatus;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'MEDIA_INVALID: no video stream',
  })
  processingError: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  processedAt: string | null;

  @ApiProperty({ type: Number, nullable: true, example: 2.04 })
  durationSeconds: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 1920 })
  width: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 1080 })
  height: number | null;

  @ApiProperty({ type: String, nullable: true, example: 'h264' })
  videoCodec: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'aac' })
  audioCodec: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'mov,mp4,m4a,3gp,3g2,mj2',
  })
  formatName: string | null;

  @ApiProperty({ type: Number, nullable: true, example: 5000000 })
  bitrate: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 29.97 })
  frameRate: number | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Presigned GET of the original (supports Range/206); only when ready',
  })
  streamUrl: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Presigned GET forcing Content-Disposition: attachment; only when ready',
  })
  downloadUrl: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Presigned GET of the thumbnail; only when ready',
  })
  thumbnailUrl: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  urlsExpireAt: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;
}
