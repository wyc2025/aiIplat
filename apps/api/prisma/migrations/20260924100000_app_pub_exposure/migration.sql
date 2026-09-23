-- P12 T108：数据应用 B 侧暴露控制（+0 表 +4 列，ARCHITECTURE §28.2 / PRD-P12 D97~D104·R100）
-- 零数据迁移：全部为带默认值的整型开关列；回滚 = 删列。
-- 暴露语义（R100）：有效暴露 = app_def.is_public ∧ app_table.is_exposed ∧ app_field.is_exposed ∧ 非内部列。

-- 应用级公开发布开关（D101 属主自助，默认关闭）
ALTER TABLE `app_def`
  ADD COLUMN `is_public` TINYINT NOT NULL DEFAULT 0 COMMENT '公开发布开关（P12 D101）' AFTER `version`;

-- 表级暴露门禁（0 = 未暴露；字段开关受其约束）
ALTER TABLE `app_table`
  ADD COLUMN `is_exposed` TINYINT NOT NULL DEFAULT 0 COMMENT '表级暴露门禁（P12 R100）' AFTER `is_system`;

-- 字段级暴露（默认 1：新增字段开箱即可暴露，实际生效仍受表门禁）
ALTER TABLE `app_field`
  ADD COLUMN `is_exposed` TINYINT NOT NULL DEFAULT 1 COMMENT '字段级暴露（P12 R100）' AFTER `is_deleted`;

-- display 页公开标记（admin 页恒 0；发布时统一走 R103 校验）
ALTER TABLE `app_page`
  ADD COLUMN `is_public` TINYINT NOT NULL DEFAULT 0 COMMENT 'display 页公开标记（P12 R102/R108）' AFTER `kind`;
