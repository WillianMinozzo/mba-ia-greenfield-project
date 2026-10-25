import { ApiProperty } from '@nestjs/swagger';
import {
  VideoProcessingStatus,
  VideoPublicationStatus,
} from '../entities/video.entity';

export class VideoUploadResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'dQw4w9WgXcQ', minLength: 11, maxLength: 11 })
  publicId: string;

  @ApiProperty({ example: 'aula' })
  title: string;

  @ApiProperty({ enum: VideoProcessingStatus, example: 'awaiting_upload' })
  processingStatus: VideoProcessingStatus;

  @ApiProperty({ enum: VideoPublicationStatus, example: 'draft' })
  publicationStatus: VideoPublicationStatus;

  @ApiProperty({ example: 67108864 })
  partSize: number;

  @ApiProperty({ example: 1 })
  partCount: number;
}
