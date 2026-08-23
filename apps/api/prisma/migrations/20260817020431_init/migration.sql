-- CreateTable
CREATE TABLE `sys_user` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `username` VARCHAR(50) NOT NULL,
    `password` VARCHAR(100) NOT NULL,
    `nickname` VARCHAR(50) NOT NULL,
    `email` VARCHAR(100) NULL,
    `phone` VARCHAR(20) NULL,
    `avatar` VARCHAR(255) NULL,
    `gender` TINYINT NOT NULL DEFAULT 0,
    `dept_id` BIGINT NULL,
    `status` TINYINT NOT NULL DEFAULT 1,
    `remark` VARCHAR(255) NULL,
    `last_login_at` DATETIME(3) NULL,
    `last_login_ip` VARCHAR(50) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `sys_user_username_key`(`username`),
    INDEX `sys_user_dept_id_idx`(`dept_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sys_role` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(50) NOT NULL,
    `code` VARCHAR(50) NOT NULL,
    `sort` INTEGER NOT NULL DEFAULT 0,
    `status` TINYINT NOT NULL DEFAULT 1,
    `remark` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `sys_role_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sys_user_role` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT NOT NULL,
    `role_id` BIGINT NOT NULL,

    INDEX `sys_user_role_role_id_idx`(`role_id`),
    UNIQUE INDEX `sys_user_role_user_id_role_id_key`(`user_id`, `role_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sys_menu` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `parent_id` BIGINT NOT NULL DEFAULT 0,
    `name` VARCHAR(50) NOT NULL,
    `type` TINYINT NOT NULL,
    `path` VARCHAR(200) NULL,
    `component` VARCHAR(200) NULL,
    `perms` VARCHAR(100) NULL,
    `icon` VARCHAR(50) NULL,
    `sort` INTEGER NOT NULL DEFAULT 0,
    `visible` TINYINT NOT NULL DEFAULT 1,
    `status` TINYINT NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `sys_menu_parent_id_idx`(`parent_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sys_role_menu` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `role_id` BIGINT NOT NULL,
    `menu_id` BIGINT NOT NULL,

    INDEX `sys_role_menu_menu_id_idx`(`menu_id`),
    UNIQUE INDEX `sys_role_menu_role_id_menu_id_key`(`role_id`, `menu_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sys_dept` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `parent_id` BIGINT NOT NULL DEFAULT 0,
    `name` VARCHAR(50) NOT NULL,
    `sort` INTEGER NOT NULL DEFAULT 0,
    `status` TINYINT NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `sys_dept_parent_id_idx`(`parent_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sys_dict_type` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(50) NOT NULL,
    `type` VARCHAR(100) NOT NULL,
    `status` TINYINT NOT NULL DEFAULT 1,
    `remark` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `sys_dict_type_type_key`(`type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sys_dict_data` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `type_id` BIGINT NOT NULL,
    `label` VARCHAR(50) NOT NULL,
    `value` VARCHAR(50) NOT NULL,
    `sort` INTEGER NOT NULL DEFAULT 0,
    `status` TINYINT NOT NULL DEFAULT 1,
    `remark` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `sys_dict_data_type_id_idx`(`type_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sys_login_log` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `username` VARCHAR(50) NOT NULL,
    `ip` VARCHAR(50) NULL,
    `browser` VARCHAR(100) NULL,
    `os` VARCHAR(100) NULL,
    `status` TINYINT NOT NULL,
    `message` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `sys_login_log_username_idx`(`username`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sys_operation_log` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT NULL,
    `username` VARCHAR(50) NULL,
    `module` VARCHAR(50) NULL,
    `action` VARCHAR(50) NULL,
    `method` VARCHAR(10) NULL,
    `url` VARCHAR(255) NULL,
    `params` TEXT NULL,
    `ip` VARCHAR(50) NULL,
    `status` TINYINT NULL,
    `error_msg` TEXT NULL,
    `duration` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `sys_operation_log_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sys_file` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `original_name` VARCHAR(255) NOT NULL,
    `storage_name` VARCHAR(255) NOT NULL,
    `path` VARCHAR(255) NOT NULL,
    `url` VARCHAR(255) NOT NULL,
    `size` BIGINT NOT NULL,
    `mime_type` VARCHAR(100) NULL,
    `uploader_id` BIGINT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
