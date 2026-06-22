-- DropForeignKey
ALTER TABLE "conversations" DROP CONSTRAINT "conversations_contact_id_fkey";

-- DropForeignKey
ALTER TABLE "messages" DROP CONSTRAINT "messages_company_id_fkey";

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "bot_examples_bot_id_idx" ON "bot_examples"("bot_id");

-- CreateIndex
CREATE INDEX "bot_examples_company_id_idx" ON "bot_examples"("company_id");

-- CreateIndex
CREATE INDEX "bots_company_id_idx" ON "bots"("company_id");

-- CreateIndex
CREATE INDEX "contacts_company_id_idx" ON "contacts"("company_id");

-- CreateIndex
CREATE INDEX "conversations_company_id_idx" ON "conversations"("company_id");

-- CreateIndex
CREATE INDEX "conversations_contact_id_idx" ON "conversations"("contact_id");

-- CreateIndex
CREATE INDEX "conversations_active_bot_id_idx" ON "conversations"("active_bot_id");

-- CreateIndex
CREATE INDEX "messages_conversation_id_idx" ON "messages"("conversation_id");

-- CreateIndex
CREATE INDEX "messages_company_id_idx" ON "messages"("company_id");

-- CreateIndex
CREATE INDEX "messages_bot_id_idx" ON "messages"("bot_id");

-- AddForeignKey
ALTER TABLE "bot_examples" ADD CONSTRAINT "bot_examples_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
