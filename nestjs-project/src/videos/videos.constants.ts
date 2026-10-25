// Fixed multipart part size (64MiB): 10GB fits in 160 parts, far below S3's 10,000-part limit.
export const VIDEO_PART_SIZE = 67108864;
export const VIDEO_MAX_SIZE_BYTES = 10737418240;
export const VIDEO_TITLE_MAX_LENGTH = 100;
export const PUBLIC_ID_MAX_ATTEMPTS = 3;
export const MAX_PART_URLS_PER_REQUEST = 100;
// Lifetime of stream/download/thumbnail URLs (4h).
export const MEDIA_URL_EXPIRATION_SECONDS = 14400;
