-- AlterTable
-- P21 T174：上游失败详情落库（status=2 时记录 [status=…] 前缀详情）
-- 注：prisma --create-only 同时检测到的历史 drift（site_article/site_column/site_tag 的
-- user_id DROP DEFAULT、app_def/app_record/market_listing/site_comment 索引改名）不并入本迁移，
-- 已登记 PROGRESS 遗留待用户决策，避免借机对生产表做范围外 DDL。
ALTER TABLE `ai_message` ADD COLUMN `error_msg` VARCHAR(500) NULL;
