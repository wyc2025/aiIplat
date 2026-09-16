-- P7 内容池化（D73/D75/R75）+ 文章路径美化（D77）：
--   ① site_article / site_column / site_tag 去 site_id、加 user_id（内容归用户，站点只是展示窗口）
--   ② 新增发表关联 site_article_publish 与栏目显隐 site_column_display
--   ③ site_comment 评论按站隔离索引调整（site_id 列已存在，回填口径见迁移脚本）
--   ④ site_site 增 spa_fallback（SPA 回退入口，D77）
-- ⚠ 执行前必须备份（R75）：mysqldump -u root -p iplat > iplat_p7_backup.sql
-- 正式执行走 `pnpm --filter @iplat/api exec tsx scripts/migrate-p7-content-pool.ts`（含前后计数校验与失败补偿指引）。

-- 1. 加列（先带默认值，回填后由脚本校验；默认值保留不影响语义）
ALTER TABLE `site_article` ADD COLUMN `user_id` BIGINT NOT NULL DEFAULT 0;
ALTER TABLE `site_column` ADD COLUMN `user_id` BIGINT NOT NULL DEFAULT 0;
ALTER TABLE `site_tag` ADD COLUMN `user_id` BIGINT NOT NULL DEFAULT 0;
ALTER TABLE `site_site` ADD COLUMN `spa_fallback` VARCHAR(64) NULL;

-- 2. 新增关联表
CREATE TABLE `site_article_publish` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `article_id` BIGINT NOT NULL,
  `site_id` BIGINT NOT NULL,
  `is_top` TINYINT NOT NULL DEFAULT 0,
  `published_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_publish_article_site` (`article_id`, `site_id`),
  KEY `idx_publish_site` (`site_id`, `is_top`, `published_at`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `site_column_display` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `column_id` BIGINT NOT NULL,
  `site_id` BIGINT NOT NULL,
  `sort` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_display_column_site` (`column_id`, `site_id`),
  KEY `idx_display_site` (`site_id`, `sort`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 3. 回填 user_id（内容行 → 其原所属站点的属主）
UPDATE `site_article` a JOIN `site_site` s ON s.id = a.site_id SET a.user_id = s.user_id;
UPDATE `site_column` c JOIN `site_site` s ON s.id = c.site_id SET c.user_id = s.user_id;
UPDATE `site_tag` t JOIN `site_site` s ON s.id = t.site_id SET t.user_id = s.user_id;

-- 4. 建关联（原 site_id 语义 = 发表/可见于该站）
INSERT INTO `site_article_publish` (`article_id`, `site_id`, `is_top`, `published_at`, `created_at`)
SELECT a.id, a.site_id, 0, a.published_at, NOW(3) FROM `site_article` a;
INSERT INTO `site_column_display` (`column_id`, `site_id`, `sort`, `created_at`)
SELECT c.id, c.site_id, c.sort, NOW(3) FROM `site_column` c;

-- 5. 新索引
ALTER TABLE `site_article` ADD INDEX `idx_article_user_status` (`user_id`, `status`, `published_at`);
ALTER TABLE `site_article` ADD INDEX `idx_article_user_column` (`user_id`, `column_id`);
ALTER TABLE `site_column` ADD INDEX `idx_column_user` (`user_id`, `parent_id`);
ALTER TABLE `site_tag` ADD UNIQUE KEY `uk_tag_user_name` (`user_id`, `name`);
ALTER TABLE `site_comment` ADD INDEX `idx_comment_site_article_audit` (`site_id`, `article_id`, `audit_status`);

-- 6. 清理旧列与旧索引（校验通过后执行；索引名取自 2026-09-16 现库实况）
ALTER TABLE `site_article`
  DROP INDEX `site_article_site_id_status_published_at_idx`,
  DROP INDEX `site_article_site_id_column_id_idx`,
  DROP COLUMN `site_id`;
ALTER TABLE `site_column`
  DROP INDEX `site_column_site_id_parent_id_idx`,
  DROP COLUMN `site_id`;
ALTER TABLE `site_tag`
  DROP INDEX `site_tag_site_id_name_key`,
  DROP INDEX `site_tag_site_id_idx`,
  DROP COLUMN `site_id`;
ALTER TABLE `site_comment`
  DROP INDEX `site_comment_site_id_audit_status_idx`;
