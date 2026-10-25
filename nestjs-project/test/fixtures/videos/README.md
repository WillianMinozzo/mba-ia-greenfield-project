# Video fixtures

Small media files used by the media/processor integration tests. They were generated once with the FFmpeg shipped in `Dockerfile.dev` and are committed, so tests never depend on generating media at runtime.

Regenerate them from `nestjs-project/` with:

```bash
docker compose exec nestjs-api sh -c "cd test/fixtures/videos && \
  ffmpeg -v error -y -f lavfi -i testsrc=duration=2:size=320x240:rate=25 -f lavfi -i sine=duration=2 -shortest -pix_fmt yuv420p sample-2s.mp4 && \
  ffmpeg -v error -y -f lavfi -i testsrc=duration=2:size=320x240:rate=25 -pix_fmt yuv420p no-audio-2s.mp4 && \
  head -c 65536 /dev/urandom > invalid.mp4"
```

| File | Content | Used to assert |
|------|---------|----------------|
| `sample-2s.mp4` | 2s, 320x240, 25fps H.264 + AAC sine | metrics extraction and thumbnail generation |
| `no-audio-2s.mp4` | same video, no audio track | `audioCodec = null` |
| `invalid.mp4` | 64KiB of random bytes | `MediaInvalidError` / `MEDIA_INVALID` |
