-- P14 T124（D112/D114）：展示应用域两表 disp_display / disp_grant。
-- 逻辑外键（relationMode=prisma，无物理 FK）：owner_id / site_id / app_id / display_id / granted_by 均不建外键。
-- 附带 R126（kind 收缩）：存量 app_page.kind='display' 页先登记（同目录 display-pages-removed.md）后删除。

-- CreateTable
CREATE TABLE `disp_display` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `owner_id` BIGINT NOT NULL,
    `name` VARCHAR(64) NOT NULL,
    `site_id` BIGINT NULL,
    `folder_path` VARCHAR(512) NOT NULL,
    `status` TINYINT NOT NULL DEFAULT 1,
    `deleted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `idx_disp_owner_status`(`owner_id`, `status`, `deleted_at`),
    INDEX `idx_disp_site_status`(`site_id`, `status`, `deleted_at`),
    UNIQUE INDEX `uk_disp_owner_name`(`owner_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `disp_grant` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `app_id` BIGINT NOT NULL,
    `display_id` BIGINT NOT NULL,
    `granted_by` BIGINT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `idx_grant_display`(`display_id`),
    UNIQUE INDEX `uk_grant_app_display`(`app_id`, `display_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- R126（D113/D126）：P12 的 display 展示页整体废弃（D113：展示改由展示应用 + 站点静态页承担），
-- 存量行先登记后删除（清单见同目录 display-pages-removed.md）。
DELETE FROM `app_page` WHERE `kind` = 'display';
