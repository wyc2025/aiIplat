-- P4d T55：cloud_share 提取码（D47/R42）
-- 哈希存储（bcrypt，不明文）；NULL = 无密码（现状兼容，留空即无密码）
ALTER TABLE `cloud_share` ADD COLUMN `password_hash` VARCHAR(64) NULL;
