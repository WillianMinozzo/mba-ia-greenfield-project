import { generatePublicId } from './public-id.util';

describe('generatePublicId', () => {
  it('should return 11 base64url characters', () => {
    for (let i = 0; i < 200; i++) {
      expect(generatePublicId()).toMatch(/^[A-Za-z0-9_-]{11}$/);
    }
  });

  it('should return distinct values on successive calls', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => generatePublicId()));
    expect(ids.size).toBe(1000);
  });
});
