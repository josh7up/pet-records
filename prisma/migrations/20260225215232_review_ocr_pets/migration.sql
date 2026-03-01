-- CreateEnum
CREATE TYPE "PetCandidateStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterEnum
ALTER TYPE "DocumentStatus" ADD VALUE 'NEEDS_REVIEW';

-- CreateTable
CREATE TABLE "DocumentPetCandidate" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "detectedName" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "status" "PetCandidateStatus" NOT NULL DEFAULT 'PENDING',
    "matchedPetId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentPetCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DocumentPetCandidate_documentId_status_idx" ON "DocumentPetCandidate"("documentId", "status");

-- CreateIndex
CREATE INDEX "DocumentPetCandidate_normalizedName_idx" ON "DocumentPetCandidate"("normalizedName");

-- AddForeignKey
ALTER TABLE "DocumentPetCandidate" ADD CONSTRAINT "DocumentPetCandidate_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
