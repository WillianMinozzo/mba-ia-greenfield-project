// Object keys derive only from the video id — never from the user's filename.
export const videoOriginalKey = (videoId: string): string =>
  `videos/${videoId}/original`;

export const videoThumbnailKey = (videoId: string): string =>
  `videos/${videoId}/thumbnail.jpg`;
