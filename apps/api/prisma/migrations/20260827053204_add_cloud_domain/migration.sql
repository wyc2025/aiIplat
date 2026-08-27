-- CreateTable
CREATE TABLE `cloud_file` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT NOT NULL,
    `parent_id` BIGINT NOT NULL DEFAULT 0,
    `name` VARCHAR(64) NOT NULL,
    `is_dir` TINYINT NOT NULL,
    `size` BIGINT NOT NULL DEFAULT 0,
    `mime` VARCHAR(100) NULL,
    `ext` VARCHAR(20) NULL,
    `storage_name` VARCHAR(120) NULL,
    `audit_status` TINYINT NOT NULL DEFAULT 0,
    `deleted_at` DATETIME(3) NULL,
    `create_time` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `update_time` DATETIME(3) NOT NULL,

    INDEX `cloud_file_user_id_parent_id_deleted_at_idx`(`user_id`, `parent_id`, `deleted_at`),
    INDEX `cloud_file_user_id_deleted_at_idx`(`user_id`, `deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cloud_share` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT NOT NULL,
    `file_id` BIGINT NOT NULL,
    `token` VARCHAR(32) NOT NULL,
    `visit_count` INTEGER NOT NULL DEFAULT 0,
    `expire_at` DATETIME(3) NULL,
    `status` TINYINT NOT NULL DEFAULT 1,
    `create_time` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `cloud_share_token_key`(`token`),
    INDEX `cloud_share_file_id_idx`(`file_id`),
    INDEX `cloud_share_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cloud_usage` (
    `user_id` BIGINT NOT NULL,
    `quota` BIGINT NOT NULL,
    `used` BIGINT NOT NULL DEFAULT 0,
    `update_time` DATETIME(3) NOT NULL,

    PRIMARY KEY (`user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
