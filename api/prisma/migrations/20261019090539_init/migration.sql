-- CreateEnum
CREATE TYPE "SplitMode" AS ENUM ('EQUAL', 'ENTITLEMENT');

-- CreateTable
CREATE TABLE "Building" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "capacityW" INTEGER NOT NULL,
    "splitMode" "SplitMode" NOT NULL DEFAULT 'EQUAL',
    "intervalMinutes" INTEGER NOT NULL DEFAULT 5,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Building_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Apartment" (
    "id" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "lotEntitlement" INTEGER NOT NULL,

    CONSTRAINT "Apartment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reading" (
    "id" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "intervalStart" TIMESTAMPTZ(3) NOT NULL,
    "solarWh" INTEGER NOT NULL,
    "exportedWh" INTEGER NOT NULL,
    "splitModeUsed" "SplitMode" NOT NULL,
    "payloadHash" CHAR(64) NOT NULL,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Reading_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Demand" (
    "readingId" TEXT NOT NULL,
    "apartmentId" TEXT NOT NULL,
    "demandWh" INTEGER NOT NULL,

    CONSTRAINT "Demand_pkey" PRIMARY KEY ("readingId","apartmentId")
);

-- CreateTable
CREATE TABLE "Allocation" (
    "readingId" TEXT NOT NULL,
    "apartmentId" TEXT NOT NULL,
    "allocatedWh" INTEGER NOT NULL,

    CONSTRAINT "Allocation_pkey" PRIMARY KEY ("readingId","apartmentId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Apartment_buildingId_label_key" ON "Apartment"("buildingId", "label");

-- CreateIndex
CREATE INDEX "Reading_buildingId_intervalStart_idx" ON "Reading"("buildingId", "intervalStart");

-- CreateIndex
CREATE UNIQUE INDEX "Reading_deviceId_intervalStart_key" ON "Reading"("deviceId", "intervalStart");

-- AddForeignKey
ALTER TABLE "Apartment" ADD CONSTRAINT "Apartment_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reading" ADD CONSTRAINT "Reading_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Demand" ADD CONSTRAINT "Demand_readingId_fkey" FOREIGN KEY ("readingId") REFERENCES "Reading"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Demand" ADD CONSTRAINT "Demand_apartmentId_fkey" FOREIGN KEY ("apartmentId") REFERENCES "Apartment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Allocation" ADD CONSTRAINT "Allocation_readingId_fkey" FOREIGN KEY ("readingId") REFERENCES "Reading"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Allocation" ADD CONSTRAINT "Allocation_apartmentId_fkey" FOREIGN KEY ("apartmentId") REFERENCES "Apartment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
