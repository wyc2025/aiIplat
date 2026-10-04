-- P19 T159：站点发布版本（D143/D146）
-- 1) 新表 site_release：发布 = 不可变快照 + 指针翻转；站内序号唯一（并发靠 Redis 锁互斥，此为数据层兜底）
-- 2) site_site 加列 active_release_id（可空）：NULL = 从未发布 → 开放层走 legacy 直挂工作副本（D144）
-- 迁移安全：仅加表 + 加可空列，无回填、无破坏性变更（PRD §2 范围 1）

CREATE TABLE `site_release` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `site_id` BIGINT NOT NULL,
  `version_no` INT NOT NULL,
  `label` VARCHAR(100) NULL,
  `file_count` INT NOT NULL,
  `total_bytes` BIGINT NOT NULL,
  `pinned` TINYINT NOT NULL DEFAULT 0,
  `created_by` BIGINT NOT NULL,
  `create_time` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `uk_release_site_version`(`site_id`, `version_no`),
  INDEX `idx_release_site`(`site_id`, `create_time`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `site_site` ADD COLUMN `active_release_id` BIGINT NULL;
