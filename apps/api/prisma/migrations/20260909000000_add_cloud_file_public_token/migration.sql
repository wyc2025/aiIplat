-- P4c T46：cloud_file 公开链接机制（D29/D30/D32）
ALTER TABLE `cloud_file` ADD COLUMN `public_token` VARCHAR(32) NULL;
ALTER TABLE `cloud_file` ADD COLUMN `allow_listing` TINYINT NOT NULL DEFAULT 1;

-- token 唯一索引（R24：URL-safe 随机串，碰撞重试兜底；NULL 不参与唯一约束）
CREATE UNIQUE INDEX `cloud_file_public_token_key` ON `cloud_file`(`public_token`);
