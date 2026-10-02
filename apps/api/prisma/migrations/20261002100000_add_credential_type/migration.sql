-- P18 T155：接入凭证第二形态 OAuth2 client_credentials（D139~D142，API-P18 §25 / ARCHITECTURE-P18 §34）
-- `acc_credential` 新增 `type` 列（`api_key` 默认 / `oauth`）——存量行自动为 `api_key`，**零数据改写**。
-- 令牌本体按 D139 存 Redis（不透明令牌，不落库），故本期**无新表、无新索引**。

-- AlterTable
ALTER TABLE `acc_credential`
    ADD COLUMN `type` VARCHAR(16) NOT NULL DEFAULT 'api_key';
