-- CreateEnum
CREATE TYPE "ResourceType" AS ENUM ('CREATIVE', 'SCRIPT', 'VIDEO');

-- CreateTable
CREATE TABLE "affiliate_resources" (
    "id" TEXT NOT NULL,
    "type" "ResourceType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "productId" TEXT,
    "fileUrl" TEXT,
    "fileFormat" TEXT,
    "fileMeta" TEXT,
    "body" TEXT,
    "videoUrl" TEXT,
    "duration" TEXT,
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "affiliate_resources_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "affiliate_resources_productId_idx" ON "affiliate_resources"("productId");

-- AddForeignKey
ALTER TABLE "affiliate_resources" ADD CONSTRAINT "affiliate_resources_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

