-- P4E T59：多站点（配额化）
-- 1) site_site 解除 user_id 唯一约束（每用户一站 → 多站），补普通索引供按用户查列表
--    （D51/R47；slug 全局唯一索引不动）
ALTER TABLE `site_site` DROP INDEX `site_site_user_id_key`;
CREATE INDEX `idx_site_user` ON `site_site`(`user_id`);

-- 2) 站点数配额表（照 cloud_usage 先例，懒创建；quota 为站点数上限，count 语义非字节）
CREATE TABLE `site_quota` (
    `user_id` BIGINT NOT NULL,
    `quota` INTEGER NOT NULL,
    `create_time` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `update_time` DATETIME(3) NOT NULL,

    PRIMARY KEY (`user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
