-- CreateTable
CREATE TABLE `ai_tool_call` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `conversation_id` BIGINT NOT NULL,
    `message_id` BIGINT NOT NULL,
    `user_id` BIGINT NOT NULL,
    `tool_name` VARCHAR(50) NOT NULL,
    `params` JSON NOT NULL,
    `risk` VARCHAR(10) NOT NULL,
    `status` VARCHAR(20) NOT NULL,
    `result` TEXT NULL,
    `error_msg` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `ai_tool_call_conversation_id_idx`(`conversation_id`),
    INDEX `ai_tool_call_user_id_created_at_idx`(`user_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
