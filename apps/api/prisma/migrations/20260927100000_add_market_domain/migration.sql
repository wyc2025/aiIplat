-- P13 T117（D107/D108）：应用市场域 1 张表 market_listing。
-- 零数据迁移：新表 + 新域；回滚 = DROP TABLE。
-- 逻辑外键（relationMode=prisma，无物理 FK）：publisher_id / reviewer_id / source_app_id 均不建外键。

CREATE TABLE `market_listing` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(64) NOT NULL,
    `publisher_id` BIGINT NOT NULL,
    `publisher_name` VARCHAR(50) NULL,
    `source_app_id` BIGINT NOT NULL,
    `name` VARCHAR(50) NOT NULL,
    `description` VARCHAR(200) NULL,
    `snapshot` JSON NOT NULL,
    `demo_data` JSON NULL,
    `has_demo` TINYINT NOT NULL DEFAULT 0,
    `status` VARCHAR(10) NOT NULL DEFAULT 'pending',
    `review_note` VARCHAR(500) NULL,
    `reviewer_id` BIGINT NULL,
    `reviewed_at` DATETIME(3) NULL,
    `listed_at` DATETIME(3) NULL,
    `delisted_at` DATETIME(3) NULL,
    `copy_count` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    UNIQUE INDEX `code`(`code`),
    INDEX `idx_market_status_listed`(`status`, `listed_at`),
    INDEX `idx_market_pub_app_status`(`publisher_id`, `source_app_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
