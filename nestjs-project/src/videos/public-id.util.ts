import { randomBytes } from 'crypto';

export const PUBLIC_ID_LENGTH = 11;

// 8 random bytes → 11 base64url characters (64 bits of entropy).
export function generatePublicId(): string {
  return randomBytes(8).toString('base64url').slice(0, PUBLIC_ID_LENGTH);
}
