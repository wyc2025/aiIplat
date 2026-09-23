-- P11 T100（D87/D91/D93）：应用平台域 7 张 app_* 表。
-- 元模型 + JSON 行：用户表只是逻辑表（app_table），数据集中 app_record.data JSON 列；
-- 真实动态建表一票否决（击穿 Prisma 迁移/备份/沙箱）。全部软删可回溯，逻辑外键（无物理 FK）。
-- 纯建表、无回填、零风险。

-- CreateTable
CREATE TABLE `app_def` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(64) NOT NULL,
    `pub_code` VARCHAR(12) NOT NULL,
    `name` VARCHAR(50) NOT NULL,
    `description` VARCHAR(200) NULL,
    `status` VARCHAR(10) NOT NULL DEFAULT 'active',
    `owner_id` BIGINT NOT NULL,
    `source_app_id` BIGINT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `deleted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `pub_code`(`pub_code`),
    UNIQUE INDEX `uk_app_owner_code`(`owner_id`, `code`),
    INDEX `idx_app_owner_status`(`owner_id`, `status`, `deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `app_table` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `app_id` BIGINT NOT NULL,
    `name` VARCHAR(64) NOT NULL,
    `label` VARCHAR(50) NOT NULL,
    `is_system` TINYINT NOT NULL DEFAULT 0,
    `deleted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `uk_table_app_name`(`app_id`, `name`),
    INDEX `idx_table_app`(`app_id`, `deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `app_field` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `table_id` BIGINT NOT NULL,
    `name` VARCHAR(64) NOT NULL,
    `label` VARCHAR(50) NOT NULL,
    `type` VARCHAR(20) NOT NULL,
    `required` TINYINT NOT NULL DEFAULT 0,
    `default_val` JSON NULL,
    `enum_options` JSON NULL,
    `ref_table_id` BIGINT NULL,
    `ref_multiple` TINYINT NOT NULL DEFAULT 0,
    `is_deleted` TINYINT NOT NULL DEFAULT 0,
    `sort` INTEGER NOT NULL DEFAULT 0,
    `deleted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `uk_field_table_name`(`table_id`, `name`),
    INDEX `idx_field_table`(`table_id`, `is_deleted`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `app_rel` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `app_id` BIGINT NOT NULL,
    `from_table_id` BIGINT NOT NULL,
    `from_field_id` BIGINT NOT NULL,
    `to_table_id` BIGINT NOT NULL,
    `type` VARCHAR(10) NOT NULL DEFAULT 'nm',
    `through_table_id` BIGINT NOT NULL,
    `deleted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `uk_rel_app_from_to`(`app_id`, `from_table_id`, `from_field_id`, `to_table_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `app_record` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `app_id` BIGINT NOT NULL,
    `table_id` BIGINT NOT NULL,
    `row_id` CHAR(36) NOT NULL,
    `data` JSON NOT NULL,
    `r_c1` VARCHAR(191) NULL,
    `r_c2` VARCHAR(191) NULL,
    `r_c3` VARCHAR(191) NULL,
    `r_c4` VARCHAR(191) NULL,
    `r_c5` VARCHAR(191) NULL,
    `created_by` BIGINT NULL,
    `deleted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `row_id`(`row_id`),
    INDEX `idx_record_table`(`table_id`, `deleted_at`),
    INDEX `idx_record_table_rc1`(`table_id`, `r_c1`),
    INDEX `idx_record_table_rc2`(`table_id`, `r_c2`),
    INDEX `idx_record_table_rc3`(`table_id`, `r_c3`),
    INDEX `idx_record_table_rc4`(`table_id`, `r_c4`),
    INDEX `idx_record_table_rc5`(`table_id`, `r_c5`),
    INDEX `idx_record_app_updated`(`app_id`, `updated_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `app_page` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `app_id` BIGINT NOT NULL,
    `kind` VARCHAR(20) NOT NULL DEFAULT 'admin',
    `code` VARCHAR(64) NOT NULL,
    `name` VARCHAR(50) NOT NULL,
    `route` VARCHAR(64) NOT NULL,
    `schema` JSON NOT NULL,
    `schema_version` INTEGER NOT NULL DEFAULT 1,
    `gen_by` VARCHAR(10) NOT NULL DEFAULT 'manual',
    `sort` INTEGER NOT NULL DEFAULT 0,
    `deleted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `uk_page_app_code`(`app_id`, `code`),
    UNIQUE INDEX `uk_page_app_route`(`app_id`, `route`),
    INDEX `idx_page_app_kind`(`app_id`, `kind`, `deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `app_attachment_ref` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `app_id` BIGINT NOT NULL,
    `table_id` BIGINT NOT NULL,
    `record_id` BIGINT NOT NULL,
    `field_name` VARCHAR(64) NOT NULL,
    `file_id` BIGINT NOT NULL,
    `deleted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `idx_attref_file`(`file_id`, `deleted_at`),
    INDEX `idx_attref_record`(`app_id`, `table_id`, `record_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
