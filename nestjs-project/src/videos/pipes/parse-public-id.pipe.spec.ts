import { VideoNotFoundException } from '../../common/exceptions/domain.exception';
import { ParsePublicIdPipe } from './parse-public-id.pipe';

describe('ParsePublicIdPipe', () => {
  const pipe = new ParsePublicIdPipe();

  it('should accept 11 base64url characters', () => {
    expect(pipe.transform('dQw4w9W-X_Q')).toBe('dQw4w9W-X_Q');
  });

  it.each(['abc', 'dQw4w9WgXcQx', ''])(
    'should reject %p (wrong length) with VIDEO_NOT_FOUND',
    (value) => {
      expect(() => pipe.transform(value)).toThrow(VideoNotFoundException);
    },
  );

  it.each(['dQw4w9WgXc!', 'dQw4w9WgXc=', 'dQw4w9WgXc/'])(
    'should reject %p (outside the alphabet) with VIDEO_NOT_FOUND',
    (value) => {
      expect(() => pipe.transform(value)).toThrow(VideoNotFoundException);
    },
  );
});
