-- CreateTable
CREATE TABLE `site_site` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT NOT NULL,
    `slug` VARCHAR(32) NOT NULL,
    `title` VARCHAR(50) NOT NULL,
    `description` VARCHAR(200) NULL,
    `root_folder_id` BIGINT NOT NULL,
    `media_folder_id` BIGINT NOT NULL,
    `status` TINYINT NOT NULL DEFAULT 1,
    `comment_audit` TINYINT NOT NULL DEFAULT 1,
    `create_time` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `update_time` DATETIME(3) NOT NULL,

    UNIQUE INDEX `site_site_user_id_key`(`user_id`),
    UNIQUE INDEX `site_site_slug_key`(`slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `site_column` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `site_id` BIGINT NOT NULL,
    `parent_id` BIGINT NOT NULL DEFAULT 0,
    `name` VARCHAR(32) NOT NULL,
    `sort` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `site_column_site_id_parent_id_idx`(`site_id`, `parent_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `site_tag` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `site_id` BIGINT NOT NULL,
    `name` VARCHAR(32) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `site_tag_site_id_idx`(`site_id`),
    UNIQUE INDEX `site_tag_site_id_name_key`(`site_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `site_article` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `site_id` BIGINT NOT NULL,
    `column_id` BIGINT NOT NULL,
    `title` VARCHAR(100) NOT NULL,
    `summary` VARCHAR(200) NOT NULL DEFAULT '',
    `cover_path` VARCHAR(255) NULL,
    `content_md` LONGTEXT NOT NULL,
    `word_count` INTEGER NOT NULL DEFAULT 0,
    `view_count` INTEGER NOT NULL DEFAULT 0,
    `status` TINYINT NOT NULL DEFAULT 0,
    `published_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `site_article_site_id_status_published_at_idx`(`site_id`, `status`, `published_at`),
    INDEX `site_article_site_id_column_id_idx`(`site_id`, `column_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `site_article_tag` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `article_id` BIGINT NOT NULL,
    `tag_id` BIGINT NOT NULL,

    INDEX `site_article_tag_article_id_idx`(`article_id`),
    INDEX `site_article_tag_tag_id_idx`(`tag_id`),
    UNIQUE INDEX `site_article_tag_article_id_tag_id_key`(`article_id`, `tag_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `site_comment` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `site_id` BIGINT NOT NULL,
    `article_id` BIGINT NOT NULL,
    `nickname` VARCHAR(32) NOT NULL,
    `content` VARCHAR(500) NOT NULL,
    `audit_status` TINYINT NOT NULL DEFAULT 0,
    `ip` VARCHAR(50) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `site_comment_article_id_audit_status_idx`(`article_id`, `audit_status`),
    INDEX `site_comment_site_id_audit_status_idx`(`site_id`, `audit_status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
