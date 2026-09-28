-- AlterTable
ALTER TABLE "WhatsAppSession" ADD COLUMN     "linkedById" TEXT,
ALTER COLUMN "userId" DROP NOT NULL;
