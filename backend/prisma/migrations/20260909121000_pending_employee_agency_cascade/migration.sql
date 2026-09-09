-- PendingEmployee is a short-lived onboarding staging table with no history
-- value: make its agency FK cascade so deleting an agency (e.g. in tests /
-- offboarding) doesn't RESTRICT on leftover staging rows.

-- DropForeignKey
ALTER TABLE "PendingEmployee" DROP CONSTRAINT "PendingEmployee_agencyId_fkey";

-- AddForeignKey
ALTER TABLE "PendingEmployee" ADD CONSTRAINT "PendingEmployee_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;
