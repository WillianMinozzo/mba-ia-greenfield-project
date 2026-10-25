import { ApiProperty } from '@nestjs/swagger';
import { VideoProcessingStatus } from '../entities/video.entity';

export class VideoCompleteResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'dQw4w9WgXcQ', minLength: 11, maxLength: 11 })
  publicId: string;

  @ApiProperty({ enum: VideoProcessingStatus, example: 'processing' })
  processingStatus: VideoProcessingStatus;
}
