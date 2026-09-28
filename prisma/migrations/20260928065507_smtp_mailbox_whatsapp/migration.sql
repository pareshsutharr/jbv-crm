-- AlterEnum
ALTER TYPE "IntegrationProvider" ADD VALUE 'SMTP';

-- AlterTable
ALTER TABLE "ConnectedAccount" ADD COLUMN     "smtpHost" TEXT,
ADD COLUMN     "smtpPort" INTEGER,
ADD COLUMN     "smtpSecure" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "smtpUser" TEXT;

-- CreateTable
CREATE TABLE "WhatsAppSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "phone" TEXT,
    "creds" TEXT,
    "connectedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppKey" (
    "sessionId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "WhatsAppKey_pkey" PRIMARY KEY ("sessionId","type","keyId")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppSession_userId_key" ON "WhatsAppSession"("userId");

-- AddForeignKey
ALTER TABLE "WhatsAppSession" ADD CONSTRAINT "WhatsAppSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppKey" ADD CONSTRAINT "WhatsAppKey_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "WhatsAppSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
