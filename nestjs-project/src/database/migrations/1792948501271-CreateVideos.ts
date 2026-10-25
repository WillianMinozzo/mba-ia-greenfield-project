import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateVideos1792948501271 implements MigrationInterface {
  name = 'CreateVideos1792948501271';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."video_processing_status" AS ENUM('awaiting_upload', 'processing', 'ready', 'failed')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."video_publication_status" AS ENUM('draft')`,
    );
    await queryRunner.query(
      `CREATE TABLE "videos" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "public_id" character varying(11) NOT NULL, "channel_id" uuid NOT NULL, "title" character varying(100) NOT NULL, "original_filename" character varying(255) NOT NULL, "content_type" character varying(100) NOT NULL, "upload_id" character varying(1024), "processing_status" "public"."video_processing_status" NOT NULL DEFAULT 'awaiting_upload', "publication_status" "public"."video_publication_status" NOT NULL DEFAULT 'draft', "processing_error" character varying(255), "processed_at" TIMESTAMP WITH TIME ZONE, "size_bytes" bigint NOT NULL, "duration_seconds" numeric(10,3), "width" integer, "height" integer, "video_codec" character varying(50), "audio_codec" character varying(50), "format_name" character varying(100), "bitrate" bigint, "frame_rate" numeric(8,3), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_39a1f0fe7991162aace659078ec" UNIQUE ("public_id"), CONSTRAINT "PK_e4c86c0cf95aff16e9fb8220f6b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_023a8e4f3f1a34ff3d8ca04a4c" ON "videos" ("channel_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cc84e47e199e109fa2a1c8c4fb" ON "videos" ("processing_status") `,
    );
    await queryRunner.query(
      `ALTER TABLE "videos" ADD CONSTRAINT "FK_023a8e4f3f1a34ff3d8ca04a4cc" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "videos" DROP CONSTRAINT "FK_023a8e4f3f1a34ff3d8ca04a4cc"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_cc84e47e199e109fa2a1c8c4fb"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_023a8e4f3f1a34ff3d8ca04a4c"`,
    );
    await queryRunner.query(`DROP TABLE "videos"`);
    await queryRunner.query(`DROP TYPE "public"."video_publication_status"`);
    await queryRunner.query(`DROP TYPE "public"."video_processing_status"`);
  }
}
