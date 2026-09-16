-- P6 T78：评论作者回复（D69/R71）
-- site_comment 增 reply_content / reply_at：一级回复（每条评论至多一条，改回复 = 更新这两列，
-- 清空 = 置 NULL）；回复不单独审核，公开可见条件是评论本身 audit_status = 1。
ALTER TABLE `site_comment` ADD COLUMN `reply_content` VARCHAR(500) NULL;
ALTER TABLE `site_comment` ADD COLUMN `reply_at` DATETIME(3) NULL;
