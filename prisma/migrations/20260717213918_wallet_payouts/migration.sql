-- CreateEnum
CREATE TYPE "PayoutAudience" AS ENUM ('AFFILIATE', 'INFLUENCER', 'VENDOR');

-- CreateEnum
CREATE TYPE "PayoutItemStatus" AS ENUM ('PENDING', 'PAID', 'FAILED');

-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'REVERSED');

-- CreateEnum
CREATE TYPE "LedgerType" AS ENUM ('CREDIT', 'DEBIT');

-- AlterEnum
BEGIN;
CREATE TYPE "PayoutBatchStatus_new" AS ENUM ('SCHEDULED', 'REVIEW', 'HELD', 'PAID', 'FAILED', 'CANCELLED');
ALTER TABLE "public"."payout_batches" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "payout_batches" ALTER COLUMN "status" TYPE "PayoutBatchStatus_new" USING ("status"::text::"PayoutBatchStatus_new");
ALTER TYPE "PayoutBatchStatus" RENAME TO "PayoutBatchStatus_old";
ALTER TYPE "PayoutBatchStatus_new" RENAME TO "PayoutBatchStatus";
DROP TYPE "public"."PayoutBatchStatus_old";
ALTER TABLE "payout_batches" ALTER COLUMN "status" SET DEFAULT 'SCHEDULED';
COMMIT;

-- AlterTable
ALTER TABLE "commission_records" ADD COLUMN     "confirmedAt" TIMESTAMP(3),
ADD COLUMN     "payoutItemId" TEXT;

-- AlterTable
ALTER TABLE "payout_batches" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "audience" "PayoutAudience" NOT NULL,
ADD COLUMN     "ref" TEXT NOT NULL,
ALTER COLUMN "status" SET DEFAULT 'SCHEDULED';

-- CreateTable
CREATE TABLE "payout_items" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "beneficiaryId" TEXT NOT NULL,
    "bankAccountId" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" "PayoutItemStatus" NOT NULL DEFAULT 'PENDING',
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payout_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfers" (
    "id" TEXT NOT NULL,
    "payoutItemId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerRef" TEXT,
    "status" "TransferStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_checks" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "passed" BOOLEAN NOT NULL,

    CONSTRAINT "compliance_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallets" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "balance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "type" "LedgerType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "source" TEXT NOT NULL,
    "sourceId" TEXT,
    "balanceAfter" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "transfers_payoutItemId_key" ON "transfers"("payoutItemId");

-- CreateIndex
CREATE UNIQUE INDEX "transfers_providerRef_key" ON "transfers"("providerRef");

-- CreateIndex
CREATE UNIQUE INDEX "transfers_idempotencyKey_key" ON "transfers"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_userId_key" ON "wallets"("userId");

-- CreateIndex
CREATE INDEX "ledger_entries_walletId_idx" ON "ledger_entries"("walletId");

-- CreateIndex
CREATE UNIQUE INDEX "payout_batches_ref_key" ON "payout_batches"("ref");

-- AddForeignKey
ALTER TABLE "commission_records" ADD CONSTRAINT "commission_records_payoutItemId_fkey" FOREIGN KEY ("payoutItemId") REFERENCES "payout_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_items" ADD CONSTRAINT "payout_items_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "payout_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_items" ADD CONSTRAINT "payout_items_beneficiaryId_fkey" FOREIGN KEY ("beneficiaryId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_payoutItemId_fkey" FOREIGN KEY ("payoutItemId") REFERENCES "payout_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_checks" ADD CONSTRAINT "compliance_checks_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "payout_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

