import {
  IsInt,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { VIDEO_MAX_SIZE_BYTES } from '../videos.constants';

export class CreateVideoUploadDto {
  /** Original file name; used for `original_filename` and the initial title. */
  @IsString()
  @Length(1, 255)
  filename: string;

  /** MIME type of the file; must be a `video/*` type. */
  @IsString()
  @MaxLength(100)
  @Matches(/^video\/[\w.+-]+$/)
  contentType: string;

  /** Declared file size in bytes (up to 10GB). */
  @IsInt()
  @Min(1)
  @Max(VIDEO_MAX_SIZE_BYTES)
  sizeBytes: number;
}
