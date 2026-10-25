import { Injectable, PipeTransform } from '@nestjs/common';
import { VideoNotFoundException } from '../../common/exceptions/domain.exception';

const PUBLIC_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

// A malformed publicId cannot belong to any video, so it is reported as not found.
@Injectable()
export class ParsePublicIdPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!PUBLIC_ID_PATTERN.test(value)) throw new VideoNotFoundException();
    return value;
  }
}
