import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { QueryFailedError } from 'typeorm';
import { ChannelsService } from '../channels/channels.service';
import {
  InvalidPartNumberException,
  UploadIncompleteException,
  UploadNotInProgressException,
  UploadSizeMismatchException,
  VideoNotFoundException,
} from '../common/exceptions/domain.exception';
import { StorageService } from '../storage/storage.service';
import { VideoProcessingPublisher } from '../video-processing/video-processing.publisher';
import { Video, VideoProcessingStatus } from './entities/video.entity';
import { VIDEO_PART_SIZE } from './videos.constants';
import { VideosService } from './videos.service';

const USER_ID = 'user-1';
const CHANNEL = { id: 'channel-1', user_id: USER_ID };

function publicIdCollision(): QueryFailedError {
  return new QueryFailedError('INSERT', [], {
    code: '23505',
    detail: 'Key (public_id)=(AAAAAAAAAAA) already exists.',
  } as unknown as Error);
}

function buildVideo(overrides: Partial<Video> = {}): Video {
  return Object.assign(new Video(), {
    id: 'video-1',
    public_id: 'AAAAAAAAAAA',
    channel_id: CHANNEL.id,
    title: 'aula',
    original_filename: 'aula.mp4',
    content_type: 'video/mp4',
    upload_id: 'upload-1',
    sizeBytes: VIDEO_PART_SIZE * 2,
    processingStatus: VideoProcessingStatus.AWAITING_UPLOAD,
    ...overrides,
  });
}

describe('VideosService', () => {
  let service: VideosService;
  const videoRepository = {
    create: jest.fn((v: Partial<Video>) => Object.assign(new Video(), v)),
    save: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    findOne: jest.fn(),
  };
  const channelsService = { findByUserId: jest.fn() };
  const storageService = {
    createMultipartUpload: jest.fn(),
    presignUploadPart: jest.fn(),
    listParts: jest.fn(),
    abortMultipartUpload: jest.fn(),
    completeMultipartUpload: jest.fn(),
    headObject: jest.fn(),
    deleteObject: jest.fn(),
    presignGetObject: jest.fn(),
  };
  const publisher = { enqueue: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    videoRepository.create.mockImplementation((v: Partial<Video>) =>
      Object.assign(new Video(), v),
    );
    channelsService.findByUserId.mockResolvedValue(CHANNEL);

    const module = await Test.createTestingModule({
      providers: [
        VideosService,
        { provide: getRepositoryToken(Video), useValue: videoRepository },
        { provide: ChannelsService, useValue: channelsService },
        { provide: StorageService, useValue: storageService },
        { provide: VideoProcessingPublisher, useValue: publisher },
      ],
    }).compile();

    service = module.get(VideosService);
  });

  describe('initiateUpload', () => {
    const input = {
      filename: 'aula.mp4',
      contentType: 'video/mp4',
      sizeBytes: 10737418240,
    };

    beforeEach(() => {
      videoRepository.save.mockImplementation((v: Video) =>
        Promise.resolve(Object.assign(v, { id: 'video-1' })),
      );
      storageService.createMultipartUpload.mockResolvedValue('upload-1');
    });

    it('should persist the upload id and compute partCount from the fixed part size', async () => {
      const result = await service.initiateUpload(USER_ID, input);

      expect(result.partSize).toBe(VIDEO_PART_SIZE);
      expect(result.partCount).toBe(160);
      expect(result.video.title).toBe('aula');
      expect(result.video.public_id).toMatch(/^[A-Za-z0-9_-]{11}$/);
      expect(storageService.createMultipartUpload).toHaveBeenCalledWith(
        'videos/video-1/original',
        'video/mp4',
      );
      expect(videoRepository.update).toHaveBeenCalledWith(
        { id: 'video-1' },
        { upload_id: 'upload-1' },
      );
    });

    it('should round partCount up for a partial last part', async () => {
      const result = await service.initiateUpload(USER_ID, {
        ...input,
        sizeBytes: VIDEO_PART_SIZE + 1,
      });

      expect(result.partCount).toBe(2);
    });

    it('should retry with a new public id when the generated one collides', async () => {
      videoRepository.save
        .mockRejectedValueOnce(publicIdCollision())
        .mockImplementationOnce((v: Video) =>
          Promise.resolve(Object.assign(v, { id: 'video-1' })),
        );

      await service.initiateUpload(USER_ID, input);

      expect(videoRepository.save).toHaveBeenCalledTimes(2);
    });

    it('should give up after 3 public id collisions', async () => {
      videoRepository.save.mockRejectedValue(publicIdCollision());

      await expect(
        service.initiateUpload(USER_ID, input),
      ).rejects.toBeInstanceOf(QueryFailedError);
      expect(videoRepository.save).toHaveBeenCalledTimes(3);
    });

    it('should remove the pre-registered row when the multipart cannot be created', async () => {
      storageService.createMultipartUpload.mockRejectedValue(
        new Error('storage down'),
      );

      await expect(service.initiateUpload(USER_ID, input)).rejects.toThrow(
        'storage down',
      );
      expect(videoRepository.delete).toHaveBeenCalledWith({ id: 'video-1' });
      expect(videoRepository.update).not.toHaveBeenCalled();
    });
  });

  describe('findOwnedByPublicId', () => {
    it('should throw VIDEO_NOT_FOUND when the video is missing or owned by another channel', async () => {
      videoRepository.findOne.mockResolvedValue(null);

      await expect(
        service.findOwnedByPublicId('other-user', 'AAAAAAAAAAA'),
      ).rejects.toBeInstanceOf(VideoNotFoundException);
      expect(videoRepository.findOne).toHaveBeenCalledWith({
        where: { public_id: 'AAAAAAAAAAA', channel: { user_id: 'other-user' } },
      });
    });
  });

  describe('signPartUrls', () => {
    it('should sign one URL per requested part', async () => {
      videoRepository.findOne.mockResolvedValue(buildVideo());
      storageService.presignUploadPart.mockImplementation(
        (_k: string, _u: string, n: number) =>
          Promise.resolve(`https://signed/${n}`),
      );

      const urls = await service.signPartUrls(USER_ID, 'AAAAAAAAAAA', [1, 2]);

      expect(urls).toEqual([
        { partNumber: 1, url: 'https://signed/1' },
        { partNumber: 2, url: 'https://signed/2' },
      ]);
    });

    it('should reject a part number above partCount with INVALID_PART_NUMBER', async () => {
      videoRepository.findOne.mockResolvedValue(buildVideo());

      await expect(
        service.signPartUrls(USER_ID, 'AAAAAAAAAAA', [3]),
      ).rejects.toBeInstanceOf(InvalidPartNumberException);
      expect(storageService.presignUploadPart).not.toHaveBeenCalled();
    });

    it('should reject with UPLOAD_NOT_IN_PROGRESS when the video is processing', async () => {
      videoRepository.findOne.mockResolvedValue(
        buildVideo({
          processingStatus: VideoProcessingStatus.PROCESSING,
          upload_id: null,
        }),
      );

      await expect(
        service.signPartUrls(USER_ID, 'AAAAAAAAAAA', [1]),
      ).rejects.toBeInstanceOf(UploadNotInProgressException);
    });
  });

  describe('getOwnedVideo', () => {
    it.each([
      VideoProcessingStatus.AWAITING_UPLOAD,
      VideoProcessingStatus.PROCESSING,
      VideoProcessingStatus.FAILED,
    ])('should not sign media URLs while %s', async (processingStatus) => {
      videoRepository.findOne.mockResolvedValue(
        buildVideo({ processingStatus }),
      );

      const view = await service.getOwnedVideo(USER_ID, 'AAAAAAAAAAA');

      expect(view.media).toBeNull();
      expect(storageService.presignGetObject).not.toHaveBeenCalled();
    });

    it('should sign stream, download and thumbnail URLs for 4h when ready', async () => {
      videoRepository.findOne.mockResolvedValue(
        buildVideo({ processingStatus: VideoProcessingStatus.READY }),
      );
      storageService.presignGetObject.mockImplementation(
        (key: string, opts: { downloadFilename?: string }) =>
          Promise.resolve(`${key}${opts.downloadFilename ? '#download' : ''}`),
      );

      const before = Date.now();
      const { media } = await service.getOwnedVideo(USER_ID, 'AAAAAAAAAAA');

      expect(media).toMatchObject({
        streamUrl: 'videos/video-1/original',
        downloadUrl: 'videos/video-1/original#download',
        thumbnailUrl: 'videos/video-1/thumbnail.jpg',
      });
      expect(storageService.presignGetObject).toHaveBeenCalledWith(
        'videos/video-1/original',
        { expiresIn: 14400, downloadFilename: 'aula.mp4' },
      );
      expect(media!.expiresAt.getTime() - before).toBeGreaterThanOrEqual(
        14400 * 1000,
      );
    });

    it('should throw VIDEO_NOT_FOUND for a non-owner', async () => {
      videoRepository.findOne.mockResolvedValue(null);

      await expect(
        service.getOwnedVideo('other-user', 'AAAAAAAAAAA'),
      ).rejects.toBeInstanceOf(VideoNotFoundException);
    });
  });

  describe('completeUpload', () => {
    const twoParts = [
      { partNumber: 1, sizeBytes: VIDEO_PART_SIZE, etag: '"a"' },
      { partNumber: 2, sizeBytes: VIDEO_PART_SIZE, etag: '"b"' },
    ];

    it.each([
      VideoProcessingStatus.PROCESSING,
      VideoProcessingStatus.READY,
      VideoProcessingStatus.FAILED,
    ])(
      'should return the current state without side effects when already %s',
      async (processingStatus) => {
        videoRepository.findOne.mockResolvedValue(
          buildVideo({ processingStatus, upload_id: null }),
        );

        const video = await service.completeUpload(USER_ID, 'AAAAAAAAAAA');

        expect(video.processingStatus).toBe(processingStatus);
        expect(storageService.listParts).not.toHaveBeenCalled();
        expect(publisher.enqueue).not.toHaveBeenCalled();
      },
    );

    it('should throw UPLOAD_INCOMPLETE without completing when parts are missing', async () => {
      videoRepository.findOne.mockResolvedValue(buildVideo());
      storageService.listParts.mockResolvedValue([twoParts[0]]);

      await expect(
        service.completeUpload(USER_ID, 'AAAAAAAAAAA'),
      ).rejects.toBeInstanceOf(UploadIncompleteException);
      expect(storageService.completeMultipartUpload).not.toHaveBeenCalled();
      expect(publisher.enqueue).not.toHaveBeenCalled();
    });

    it('should delete the object and mark the video failed on UPLOAD_SIZE_MISMATCH', async () => {
      videoRepository.findOne.mockResolvedValue(buildVideo());
      storageService.listParts.mockResolvedValue(twoParts);
      storageService.headObject.mockResolvedValue({
        contentLength: VIDEO_PART_SIZE * 2 - 1,
      });

      await expect(
        service.completeUpload(USER_ID, 'AAAAAAAAAAA'),
      ).rejects.toBeInstanceOf(UploadSizeMismatchException);
      expect(storageService.deleteObject).toHaveBeenCalledWith(
        'videos/video-1/original',
      );
      const [criteria, changes] = videoRepository.update.mock.calls[0] as [
        unknown,
        Partial<Video>,
      ];
      expect(criteria).toEqual({ id: 'video-1' });
      expect(changes.processingStatus).toBe(VideoProcessingStatus.FAILED);
      expect(changes.processingError).toMatch(/^UPLOAD_SIZE_MISMATCH: /);
      expect(publisher.enqueue).not.toHaveBeenCalled();
    });

    it('should move the video to processing and only then enqueue process-video', async () => {
      videoRepository.findOne.mockResolvedValue(buildVideo());
      storageService.listParts.mockResolvedValue(twoParts);
      storageService.headObject.mockResolvedValue({
        contentLength: VIDEO_PART_SIZE * 2,
      });
      const calls: string[] = [];
      videoRepository.update.mockImplementation(() => {
        calls.push('update');
        return Promise.resolve();
      });
      publisher.enqueue.mockImplementation(() => {
        calls.push('enqueue');
        return Promise.resolve();
      });

      const video = await service.completeUpload(USER_ID, 'AAAAAAAAAAA');

      expect(video.processingStatus).toBe(VideoProcessingStatus.PROCESSING);
      expect(storageService.completeMultipartUpload).toHaveBeenCalledWith(
        'videos/video-1/original',
        'upload-1',
        twoParts,
      );
      expect(videoRepository.update).toHaveBeenCalledWith(
        { id: 'video-1' },
        {
          processingStatus: VideoProcessingStatus.PROCESSING,
          upload_id: null,
          sizeBytes: VIDEO_PART_SIZE * 2,
        },
      );
      expect(calls).toEqual(['update', 'enqueue']);
      expect(publisher.enqueue).toHaveBeenCalledWith('video-1');
    });
  });

  describe('abortUpload', () => {
    it('should abort the multipart and remove the row', async () => {
      videoRepository.findOne.mockResolvedValue(buildVideo());

      await service.abortUpload(USER_ID, 'AAAAAAAAAAA');

      expect(storageService.abortMultipartUpload).toHaveBeenCalledWith(
        'videos/video-1/original',
        'upload-1',
      );
      expect(videoRepository.delete).toHaveBeenCalledWith({ id: 'video-1' });
    });

    it('should reject with UPLOAD_NOT_IN_PROGRESS outside awaiting_upload', async () => {
      videoRepository.findOne.mockResolvedValue(
        buildVideo({ processingStatus: VideoProcessingStatus.READY }),
      );

      await expect(
        service.abortUpload(USER_ID, 'AAAAAAAAAAA'),
      ).rejects.toBeInstanceOf(UploadNotInProgressException);
      expect(videoRepository.delete).not.toHaveBeenCalled();
    });
  });
});
