import { DataSource, Repository } from 'typeorm';
import { RefreshToken } from '../../auth/entities/refresh-token.entity';
import { VerificationToken } from '../../auth/entities/verification-token.entity';
import { Channel } from '../../channels/entities/channel.entity';
import {
  cleanAllTables,
  createTestDataSource,
} from '../../test/create-test-data-source';
import { User } from '../../users/entities/user.entity';
import { generatePublicId } from '../public-id.util';
import {
  Video,
  VideoProcessingStatus,
  VideoPublicationStatus,
} from './video.entity';

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken, Video];

describe('Video entity (integration)', () => {
  let dataSource: DataSource;
  let userRepository: Repository<User>;
  let channelRepository: Repository<Channel>;
  let videoRepository: Repository<Video>;

  beforeAll(async () => {
    dataSource = createTestDataSource(ALL_ENTITIES);
    await dataSource.initialize();
    userRepository = dataSource.getRepository(User);
    channelRepository = dataSource.getRepository(Channel);
    videoRepository = dataSource.getRepository(Video);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
  });

  let counter = 0;
  async function createChannel(): Promise<Channel> {
    const n = ++counter;
    const user = await userRepository.save(
      userRepository.create({
        email: `video_user_${n}@example.com`,
        password: 'hashed',
      }),
    );
    return channelRepository.save(
      channelRepository.create({
        name: `Channel ${n}`,
        nickname: `video-chan-${n}`,
        user_id: user.id,
      }),
    );
  }

  function buildVideo(channelId: string, overrides: Partial<Video> = {}) {
    return videoRepository.create({
      public_id: generatePublicId(),
      channel_id: channelId,
      title: 'aula',
      original_filename: 'aula.mp4',
      content_type: 'video/mp4',
      upload_id: 'upload-1',
      sizeBytes: 15728640,
      ...overrides,
    });
  }

  it('should default to awaiting_upload / draft when no status is given', async () => {
    const channel = await createChannel();
    const saved = await videoRepository.save(buildVideo(channel.id));

    const [row] = await dataSource.query<
      { processing_status: string; publication_status: string }[]
    >(
      'SELECT processing_status, publication_status FROM videos WHERE id = $1',
      [saved.id],
    );
    expect(row).toEqual({
      processing_status: VideoProcessingStatus.AWAITING_UPLOAD,
      publication_status: VideoPublicationStatus.DRAFT,
    });
  });

  it('should reject a duplicated public_id', async () => {
    const channel = await createChannel();
    await videoRepository.save(
      buildVideo(channel.id, { public_id: 'AAAAAAAAAAA' }),
    );

    await expect(
      videoRepository.save(
        buildVideo(channel.id, { public_id: 'AAAAAAAAAAA' }),
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('should reject a processing_status outside the enum', async () => {
    const channel = await createChannel();
    const saved = await videoRepository.save(buildVideo(channel.id));

    await expect(
      dataSource.query(
        `UPDATE videos SET processing_status = 'uploaded' WHERE id = $1`,
        [saved.id],
      ),
    ).rejects.toMatchObject({ code: '22P02' });
  });

  it('should delete the channel videos in cascade', async () => {
    const channel = await createChannel();
    await videoRepository.save(buildVideo(channel.id));
    await videoRepository.save(buildVideo(channel.id));

    await channelRepository.delete({ id: channel.id });

    expect(await videoRepository.count()).toBe(0);
  });

  it('should accept a null audio_codec and read numeric metrics back as numbers', async () => {
    const channel = await createChannel();
    const saved = await videoRepository.save(
      buildVideo(channel.id, {
        processingStatus: VideoProcessingStatus.READY,
        durationSeconds: 2.04,
        width: 320,
        height: 240,
        videoCodec: 'h264',
        audioCodec: null,
        formatName: 'mov,mp4,m4a,3gp,3g2,mj2',
        bitrate: 123456,
        frameRate: 25,
      }),
    );

    const loaded = await videoRepository.findOneByOrFail({ id: saved.id });
    expect(loaded.audioCodec).toBeNull();
    expect(loaded.sizeBytes).toBe(15728640);
    expect(loaded.durationSeconds).toBe(2.04);
    expect(loaded.bitrate).toBe(123456);
    expect(loaded.frameRate).toBe(25);
  });
});
