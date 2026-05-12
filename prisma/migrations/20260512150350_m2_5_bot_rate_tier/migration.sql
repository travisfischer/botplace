-- CreateEnum
CREATE TYPE "BotRateTier" AS ENUM ('FREE', 'POWER', 'ADMIN');

-- AlterTable
ALTER TABLE "bots" ADD COLUMN     "rate_tier" "BotRateTier" NOT NULL DEFAULT 'FREE';
