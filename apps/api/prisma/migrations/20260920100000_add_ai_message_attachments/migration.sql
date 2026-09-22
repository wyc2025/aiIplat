-- P10 T96（D82）：AI 对话附件上传（文本类）——消息附件元信息列。
-- 只存元信息（fileId / name / ext / size / chars / mode / path），**不冗余附件内容**：
-- 历史轮次重组装时按 fileId 重读云盘，源文件被删 → 该附件标注失效降级（不报错、不阻断对话）。
-- 纯加列、无回填、零风险。
ALTER TABLE `ai_message`
  ADD COLUMN `attachments` JSON NULL COMMENT '附件元信息 [{fileId,name,ext,size,chars,mode,path}]，mode=inject|listed；仅存元信息不存内容';
