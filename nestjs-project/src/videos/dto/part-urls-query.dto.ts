import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsInt,
  Min,
} from 'class-validator';
import { MAX_PART_URLS_PER_REQUEST } from '../videos.constants';

const toPartNumbers = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string'
    ? value.split(',').map((n) => (n.trim() === '' ? NaN : Number(n)))
    : value;

export class PartUrlsQueryDto {
  @ApiProperty({
    type: String,
    example: '1,2,3',
    description: `Comma-separated distinct part numbers (1 to ${MAX_PART_URLS_PER_REQUEST} items)`,
  })
  @Transform(toPartNumbers)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_PART_URLS_PER_REQUEST)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  partNumbers: number[];
}
