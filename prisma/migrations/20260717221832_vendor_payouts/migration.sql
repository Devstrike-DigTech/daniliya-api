-- AlterEnum
ALTER TYPE "BeneficiaryType" ADD VALUE 'VENDOR';

-- AlterTable
ALTER TABLE "vendor_profiles" ADD COLUMN     "takeRateBps" INTEGER NOT NULL DEFAULT 1000;

