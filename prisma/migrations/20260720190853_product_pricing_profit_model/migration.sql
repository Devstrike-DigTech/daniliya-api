-- CreateEnum
CREATE TYPE "CommissionMode" AS ENUM ('INCLUSIVE', 'ADD_ON');

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "affiliateEligible" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "commissionMode" "CommissionMode" NOT NULL DEFAULT 'INCLUSIVE',
ADD COLUMN     "costPrice" DECIMAL(12,2),
ADD COLUMN     "influencerEligible" BOOLEAN NOT NULL DEFAULT true;
