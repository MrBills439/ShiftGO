-- CreateTable
CREATE TABLE "ShareCode" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL DEFAULT 'default-agency',
    "userId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "shareDate" TIMESTAMP(3) NOT NULL,
    "documentPath" TEXT,
    "documentName" TEXT,
    "notes" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShareCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShareCode_userId_key" ON "ShareCode"("userId");

-- CreateIndex
CREATE INDEX "ShareCode_agencyId_idx" ON "ShareCode"("agencyId");

-- AddForeignKey
ALTER TABLE "ShareCode" ADD CONSTRAINT "ShareCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareCode" ADD CONSTRAINT "ShareCode_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareCode" ADD CONSTRAINT "ShareCode_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
