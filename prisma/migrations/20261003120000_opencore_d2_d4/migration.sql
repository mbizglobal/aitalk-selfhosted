
-- AlterTable
ALTER TABLE "work_project" ADD COLUMN     "approval_settings" JSONB;

-- AlterTable
ALTER TABLE "work_task" ADD COLUMN     "approval_request" BYTEA;

-- AlterTable
ALTER TABLE "work_submission" ADD COLUMN     "approved_by" VARCHAR(80),
ADD COLUMN     "prepared_by" VARCHAR(80);

-- CreateTable
CREATE TABLE "ai_connections" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "kind" VARCHAR(30) NOT NULL,
    "base_url" VARCHAR(500) NOT NULL,
    "api_key" TEXT NOT NULL,
    "headers" TEXT,
    "api_version" VARCHAR(40),
    "text_model" VARCHAR(200) NOT NULL,
    "image_model" VARCHAR(200),
    "embedding_model" VARCHAR(200),
    "max_output_tokens" INTEGER,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "check_result" JSONB,
    "check_fingerprint" VARCHAR(64),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_generations" (
    "id" SERIAL NOT NULL,
    "connection_id" VARCHAR(30) NOT NULL,
    "embedding_model" VARCHAR(200) NOT NULL,
    "dimension" INTEGER,
    "status" VARCHAR(20) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activated_at" TIMESTAMP(3),

    CONSTRAINT "knowledge_generations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_chunks" (
    "id" VARCHAR(120) NOT NULL,
    "generation_id" INTEGER NOT NULL,
    "user_id" VARCHAR(25) NOT NULL,
    "agent_id" VARCHAR(25) NOT NULL,
    "storage_id" INTEGER NOT NULL,
    "ingest_id" VARCHAR(40) NOT NULL,
    "rag_space" VARCHAR(20) NOT NULL DEFAULT '',
    "title" VARCHAR(500) NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" REAL[],
    "embedding_model" VARCHAR(200) NOT NULL,
    "dimension" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "knowledge_generations_status_idx" ON "knowledge_generations"("status");

-- CreateIndex
CREATE INDEX "knowledge_chunks_generation_id_agent_id_idx" ON "knowledge_chunks"("generation_id", "agent_id");

-- CreateIndex
CREATE INDEX "knowledge_chunks_storage_id_idx" ON "knowledge_chunks"("storage_id");

-- CreateIndex
CREATE INDEX "knowledge_chunks_user_id_idx" ON "knowledge_chunks"("user_id");

-- AddForeignKey
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_generation_id_fkey" FOREIGN KEY ("generation_id") REFERENCES "knowledge_generations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_storage_id_fkey" FOREIGN KEY ("storage_id") REFERENCES "storage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

