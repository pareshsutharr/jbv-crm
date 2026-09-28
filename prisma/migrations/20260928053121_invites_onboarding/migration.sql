-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'USER_JOINED';

-- AlterTable
ALTER TABLE "CompanyProfile" ADD COLUMN     "systemSenderUserId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "designation" TEXT,
ADD COLUMN     "meetingLink" TEXT,
ADD COLUMN     "onboardedAt" TIMESTAMP(3),
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "whatsapp" TEXT;

-- CreateTable
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "designation" TEXT,
    "phone" TEXT,
    "role" "Role" NOT NULL DEFAULT 'RM',
    "tokenHash" TEXT NOT NULL,
    "tokenEncrypted" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "invitedById" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "sentVia" TEXT,
    "sendError" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "acceptedUserId" TEXT,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "Invitation"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_acceptedUserId_key" ON "Invitation"("acceptedUserId");

-- CreateIndex
CREATE INDEX "Invitation_email_idx" ON "Invitation"("email");

-- CreateIndex
CREATE INDEX "Invitation_invitedById_idx" ON "Invitation"("invitedById");

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_acceptedUserId_fkey" FOREIGN KEY ("acceptedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Existing users predate the onboarding checklist: treat them as onboarded.
UPDATE "User" SET "onboardedAt" = "createdAt" WHERE "onboardedAt" IS NULL;
