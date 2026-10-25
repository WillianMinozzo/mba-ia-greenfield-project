import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  type ValueTransformer,
} from 'typeorm';
import { Channel } from '../../channels/entities/channel.entity';

export enum VideoProcessingStatus {
  AWAITING_UPLOAD = 'awaiting_upload',
  PROCESSING = 'processing',
  READY = 'ready',
  FAILED = 'failed',
}

export enum VideoPublicationStatus {
  DRAFT = 'draft',
}

// pg returns bigint/numeric as strings; every value here fits a JS number (≤ 10GB, fps, seconds).
const numericTransformer: ValueTransformer = {
  to: (value: number | null | undefined) => value,
  from: (value: string | null) => (value === null ? null : Number(value)),
};

@Entity('videos')
export class Video {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 11, unique: true })
  public_id: string;

  @Index()
  @Column({ type: 'uuid' })
  channel_id: string;

  @Column({ type: 'varchar', length: 100 })
  title: string;

  @Column({ type: 'varchar', length: 255 })
  original_filename: string;

  @Column({ type: 'varchar', length: 100 })
  content_type: string;

  @Column({ type: 'varchar', length: 1024, nullable: true })
  upload_id: string | null;

  @Index()
  @Column({
    name: 'processing_status',
    type: 'enum',
    enum: VideoProcessingStatus,
    enumName: 'video_processing_status',
    default: VideoProcessingStatus.AWAITING_UPLOAD,
  })
  processingStatus: VideoProcessingStatus;

  @Column({
    name: 'publication_status',
    type: 'enum',
    enum: VideoPublicationStatus,
    enumName: 'video_publication_status',
    default: VideoPublicationStatus.DRAFT,
  })
  publicationStatus: VideoPublicationStatus;

  @Column({
    name: 'processing_error',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  processingError: string | null;

  @Column({ name: 'processed_at', type: 'timestamptz', nullable: true })
  processedAt: Date | null;

  @Column({
    name: 'size_bytes',
    type: 'bigint',
    transformer: numericTransformer,
  })
  sizeBytes: number;

  @Column({
    name: 'duration_seconds',
    type: 'numeric',
    precision: 10,
    scale: 3,
    nullable: true,
    transformer: numericTransformer,
  })
  durationSeconds: number | null;

  @Column({ type: 'integer', nullable: true })
  width: number | null;

  @Column({ type: 'integer', nullable: true })
  height: number | null;

  @Column({ name: 'video_codec', type: 'varchar', length: 50, nullable: true })
  videoCodec: string | null;

  @Column({ name: 'audio_codec', type: 'varchar', length: 50, nullable: true })
  audioCodec: string | null;

  @Column({
    name: 'format_name',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  formatName: string | null;

  @Column({
    type: 'bigint',
    nullable: true,
    transformer: numericTransformer,
  })
  bitrate: number | null;

  @Column({
    name: 'frame_rate',
    type: 'numeric',
    precision: 8,
    scale: 3,
    nullable: true,
    transformer: numericTransformer,
  })
  frameRate: number | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @ManyToOne(() => Channel, (channel) => channel.videos, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'channel_id' })
  channel: Channel;
}
