-- P15 T132：对外开放接入层（D119~D128，API-P15 §1/§2 / ARCHITECTURE-P15 §2）
-- 新增 `acc_credential`（接入凭证，D126 一凭证一应用）与 `acc_audit`（接入审计，D122/R135）两表。
-- 全逻辑外键（relationMode=prisma，无物理 FK）；跨域禁 JOIN；仅新增，不改动既有表。

-- CreateTable
CREATE TABLE `acc_credential` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `owner_id` BIGINT NOT NULL,
    `app_id` BIGINT NOT NULL,
    `name` VARCHAR(64) NOT NULL,
    `key_id` VARCHAR(16) NOT NULL,
    `secret_hash` CHAR(64) NOT NULL,
    `secret_prefix` VARCHAR(8) NOT NULL,
    `scope` JSON NOT NULL,
    `status` TINYINT NOT NULL DEFAULT 1,
    `expires_at` DATETIME(3) NULL,
    `last_used_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `uk_cred_keyid`(`key_id`),
    INDEX `idx_cred_app`(`app_id`),
    INDEX `idx_cred_owner`(`owner_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `acc_audit` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `principal` VARCHAR(40) NOT NULL,
    `owner_id` BIGINT NOT NULL,
    `app_id` BIGINT NULL,
    `endpoint` VARCHAR(32) NOT NULL,
    `table_name` VARCHAR(64) NULL,
    `params_summary` VARCHAR(512) NULL,
    `rows` INTEGER NOT NULL DEFAULT 0,
    `duration_ms` INTEGER NOT NULL DEFAULT 0,
    `ip` VARCHAR(64) NULL,
    `result_code` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL,

    INDEX `idx_audit_cred_time`(`principal`, `created_at`),
    INDEX `idx_audit_owner_time`(`owner_id`, `created_at`),
    INDEX `idx_audit_created`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
