-- CreateIndex
CREATE INDEX `ai_usage_log_conversation_id_idx` ON `ai_usage_log`(`conversation_id`);

-- CreateIndex
CREATE INDEX `ai_usage_log_model_id_idx` ON `ai_usage_log`(`model_id`);
