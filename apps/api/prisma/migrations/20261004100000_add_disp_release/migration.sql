-- P20 T167：展示应用版本检查点（D152）
-- 新表 disp_release：把展示应用工作区复制为不可变快照，可恢复到工作区（误删页面 / AI 改坏的回退点）。
-- 与 site_release 同构但**独立**：展示应用有自己的节奏，不随站点发布；
-- 站点版本里的 disp 子树是发布聚合的产物，不能反向当检查点用。
-- 迁移安全：仅加表，无回填、无破坏性变更。

CREATE TABLE `disp_release` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `display_id` BIGINT NOT NULL,
  `version_no` INT NOT NULL,
  `label` VARCHAR(100) NULL,
  `file_count` INT NOT NULL,
  `total_bytes` BIGINT NOT NULL,
  `pinned` TINYINT NOT NULL DEFAULT 0,
  `created_by` BIGINT NOT NULL,
  `create_time` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `uk_disp_release_version`(`display_id`, `version_no`),
  INDEX `idx_disp_release`(`display_id`, `create_time`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
