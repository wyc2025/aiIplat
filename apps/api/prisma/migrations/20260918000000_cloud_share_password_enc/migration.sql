-- 分享提取码「可回显」改造：
-- bcrypt 哈希（password_hash）只能校验、不能回显，而分享者需要看到自己设过的提取码，
-- 故新增一列 AES-256-GCM 密文（password_enc）专供管理侧列表回显；校验链路不变。
-- 历史分享行该列为 NULL → 接口返回 password=null，前端提示「已设置（旧数据不可回显）」，
-- 分享者重新设置提取码后即可正常查看。
ALTER TABLE `cloud_share` ADD COLUMN `password_enc` VARCHAR(255) NULL;
