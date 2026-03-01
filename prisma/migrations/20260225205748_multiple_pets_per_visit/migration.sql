/*
  Warnings:

  - A unique constraint covering the columns `[documentId,petId]` on the table `Visit` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "Visit_documentId_key";

-- CreateIndex
CREATE INDEX "Visit_documentId_idx" ON "Visit"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "Visit_documentId_petId_key" ON "Visit"("documentId", "petId");
