-- Database-level guarantees (ADR-001): the database refuses impossible energy values
-- even if application validation is bypassed. Prisma quotes camelCase columns.

ALTER TABLE "Building"
  ADD CONSTRAINT "Building_capacityW_positive" CHECK ("capacityW" > 0);

ALTER TABLE "Apartment"
  ADD CONSTRAINT "Apartment_lotEntitlement_positive" CHECK ("lotEntitlement" > 0);

ALTER TABLE "Reading"
  ADD CONSTRAINT "Reading_solarWh_nonnegative" CHECK ("solarWh" >= 0),
  ADD CONSTRAINT "Reading_exportedWh_nonnegative" CHECK ("exportedWh" >= 0);

ALTER TABLE "Demand"
  ADD CONSTRAINT "Demand_demandWh_nonnegative" CHECK ("demandWh" >= 0);

ALTER TABLE "Allocation"
  ADD CONSTRAINT "Allocation_allocatedWh_nonnegative" CHECK ("allocatedWh" >= 0);
