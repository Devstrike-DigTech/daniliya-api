-- AlterTable
ALTER TABLE "click_events" ADD COLUMN     "affiliateCode" TEXT,
ALTER COLUMN "influencerCode" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "click_events_affiliateCode_timestamp_idx" ON "click_events"("affiliateCode", "timestamp");

-- CreateIndex
CREATE INDEX "click_events_influencerCode_timestamp_idx" ON "click_events"("influencerCode", "timestamp");

