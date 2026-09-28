/*
  Warnings:

  - You are about to drop the `WhatsAppKey` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `WhatsAppSession` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "WhatsAppKey" DROP CONSTRAINT "WhatsAppKey_sessionId_fkey";

-- DropForeignKey
ALTER TABLE "WhatsAppSession" DROP CONSTRAINT "WhatsAppSession_userId_fkey";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "callMeBotKey" TEXT,
ADD COLUMN     "whatsappAlerts" BOOLEAN NOT NULL DEFAULT true;

-- DropTable
DROP TABLE "WhatsAppKey";

-- DropTable
DROP TABLE "WhatsAppSession";
