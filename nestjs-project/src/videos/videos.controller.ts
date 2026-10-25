import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import type { JwtPayload } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiErrorEnvelope } from '../common/openapi/api-error-envelope.dto';
import { PRESIGN_EXPIRATION_SECONDS } from '../storage/storage.constants';
import { CreateVideoUploadDto } from './dto/create-video-upload.dto';
import { PartUrlsQueryDto } from './dto/part-urls-query.dto';
import { PartUrlsResponseDto } from './dto/part-urls-response.dto';
import { UploadedPartsResponseDto } from './dto/uploaded-parts-response.dto';
import { VideoCompleteResponseDto } from './dto/video-complete-response.dto';
import { VideoResponseDto } from './dto/video-response.dto';
import { toVideoResponse } from './video-response.mapper';
import { VideoUploadResponseDto } from './dto/video-upload-response.dto';
import { ParsePublicIdPipe } from './pipes/parse-public-id.pipe';
import { VideosService } from './videos.service';

const ERROR_SCHEMA = { $ref: getSchemaPath(ApiErrorEnvelope) };

@ApiTags('videos')
@ApiBearerAuth('access-token')
@Controller('videos')
export class VideosController {
  constructor(private readonly videosService: VideosService) {}

  @Post()
  @ApiOperation({
    summary: 'Pre-register a video upload',
    description:
      'Creates the video as an awaiting_upload draft in the caller channel and starts the multipart upload in storage.',
  })
  @ApiResponse({ status: 201, type: VideoUploadResponseDto })
  @ApiResponse({
    status: 400,
    description: 'Validation failed',
    schema: ERROR_SCHEMA,
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: ERROR_SCHEMA,
  })
  async create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateVideoUploadDto,
  ): Promise<VideoUploadResponseDto> {
    const { video, partSize, partCount } =
      await this.videosService.initiateUpload(user.sub, dto);
    return {
      id: video.id,
      publicId: video.public_id,
      title: video.title,
      processingStatus: video.processingStatus,
      publicationStatus: video.publicationStatus,
      partSize,
      partCount,
    };
  }

  @Get(':publicId')
  @ApiOperation({
    summary: 'Get video details',
    description:
      'Returns the owner view of the video. streamUrl, downloadUrl and thumbnailUrl are presigned storage URLs, present only when processingStatus is ready.',
  })
  @ApiResponse({ status: 200, type: VideoResponseDto })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: ERROR_SCHEMA,
  })
  @ApiResponse({
    status: 404,
    description: 'VIDEO_NOT_FOUND',
    schema: ERROR_SCHEMA,
  })
  async findOne(
    @CurrentUser() user: JwtPayload,
    @Param('publicId', ParsePublicIdPipe) publicId: string,
  ): Promise<VideoResponseDto> {
    const { video, media } = await this.videosService.getOwnedVideo(
      user.sub,
      publicId,
    );
    return toVideoResponse(video, media);
  }

  @Get(':publicId/upload/part-urls')
  @ApiOperation({
    summary: 'Sign upload part URLs',
    description:
      'Returns presigned UploadPart URLs; the client PUTs each part directly to storage.',
  })
  @ApiResponse({ status: 200, type: PartUrlsResponseDto })
  @ApiResponse({
    status: 400,
    description:
      'Invalid partNumbers (VALIDATION_ERROR or INVALID_PART_NUMBER)',
    schema: ERROR_SCHEMA,
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: ERROR_SCHEMA,
  })
  @ApiResponse({
    status: 404,
    description: 'VIDEO_NOT_FOUND',
    schema: ERROR_SCHEMA,
  })
  @ApiResponse({
    status: 409,
    description: 'UPLOAD_NOT_IN_PROGRESS',
    schema: ERROR_SCHEMA,
  })
  async signPartUrls(
    @CurrentUser() user: JwtPayload,
    @Param('publicId', ParsePublicIdPipe) publicId: string,
    @Query() query: PartUrlsQueryDto,
  ): Promise<PartUrlsResponseDto> {
    const parts = await this.videosService.signPartUrls(
      user.sub,
      publicId,
      query.partNumbers,
    );
    const expiresAt = new Date(
      Date.now() + PRESIGN_EXPIRATION_SECONDS.UPLOAD_PART * 1000,
    ).toISOString();
    return { parts, expiresAt };
  }

  @Get(':publicId/upload/parts')
  @ApiOperation({
    summary: 'List uploaded parts',
    description:
      'Lists the parts storage already received, to resume an upload.',
  })
  @ApiResponse({ status: 200, type: UploadedPartsResponseDto })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: ERROR_SCHEMA,
  })
  @ApiResponse({
    status: 404,
    description: 'VIDEO_NOT_FOUND',
    schema: ERROR_SCHEMA,
  })
  @ApiResponse({
    status: 409,
    description: 'UPLOAD_NOT_IN_PROGRESS',
    schema: ERROR_SCHEMA,
  })
  async listUploadedParts(
    @CurrentUser() user: JwtPayload,
    @Param('publicId', ParsePublicIdPipe) publicId: string,
  ): Promise<UploadedPartsResponseDto> {
    const parts = await this.videosService.listUploadedParts(
      user.sub,
      publicId,
    );
    return { parts };
  }

  @Post(':publicId/upload/complete')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Complete an upload',
    description:
      'Completes the multipart upload, validates the final size and enqueues processing. Idempotent: repeating the call returns the current status without a new job.',
  })
  @ApiResponse({ status: 202, type: VideoCompleteResponseDto })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: ERROR_SCHEMA,
  })
  @ApiResponse({
    status: 404,
    description: 'VIDEO_NOT_FOUND',
    schema: ERROR_SCHEMA,
  })
  @ApiResponse({
    status: 409,
    description: 'UPLOAD_INCOMPLETE or UPLOAD_SIZE_MISMATCH',
    schema: ERROR_SCHEMA,
  })
  async completeUpload(
    @CurrentUser() user: JwtPayload,
    @Param('publicId', ParsePublicIdPipe) publicId: string,
  ): Promise<VideoCompleteResponseDto> {
    const video = await this.videosService.completeUpload(user.sub, publicId);
    return {
      id: video.id,
      publicId: video.public_id,
      processingStatus: video.processingStatus,
    };
  }

  @Delete(':publicId/upload')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Cancel an upload',
    description:
      'Aborts the multipart upload and removes the pre-registered video.',
  })
  @ApiResponse({ status: 204, description: 'Upload cancelled' })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: ERROR_SCHEMA,
  })
  @ApiResponse({
    status: 404,
    description: 'VIDEO_NOT_FOUND',
    schema: ERROR_SCHEMA,
  })
  @ApiResponse({
    status: 409,
    description: 'UPLOAD_NOT_IN_PROGRESS',
    schema: ERROR_SCHEMA,
  })
  async abortUpload(
    @CurrentUser() user: JwtPayload,
    @Param('publicId', ParsePublicIdPipe) publicId: string,
  ): Promise<void> {
    await this.videosService.abortUpload(user.sub, publicId);
  }
}
