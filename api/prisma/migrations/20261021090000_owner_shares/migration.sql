-- Owner-set shares (ADR-010): a third split mode and a per-apartment share.

-- AlterEnum
ALTER TYPE "SplitMode" ADD VALUE 'CUSTOM';

-- AlterTable
ALTER TABLE "Apartment" ADD COLUMN "customSharePct" INTEGER;

-- The database refuses an impossible share even if validation is bypassed.
ALTER TABLE "Apartment"
  ADD CONSTRAINT "Apartment_customSharePct_range"
  CHECK ("customSharePct" IS NULL OR ("customSharePct" BETWEEN 1 AND 100));
