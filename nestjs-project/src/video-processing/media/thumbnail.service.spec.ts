import { parseFrameRate } from './media-probe.service';
import { thumbnailTimestamp } from './thumbnail.service';

describe('thumbnailTimestamp', () => {
  it('should use t = 0 for videos shorter than 1s', () => {
    expect(thumbnailTimestamp(0.5)).toBe(0);
  });

  it('should clamp to 1s when 10% of the duration is below 1s', () => {
    expect(thumbnailTimestamp(5)).toBe(1);
  });

  it('should use 10% of the duration for long videos', () => {
    expect(thumbnailTimestamp(7200)).toBe(720);
  });
});

describe('parseFrameRate', () => {
  it('should convert NTSC rationals to fps with 3 decimals', () => {
    expect(parseFrameRate('30000/1001')).toBe(29.97);
  });

  it('should convert integer rationals', () => {
    expect(parseFrameRate('25/1')).toBe(25);
  });

  it.each([undefined, '0/0', 'abc'])('should return null for %p', (rate) => {
    expect(parseFrameRate(rate)).toBeNull();
  });
});
