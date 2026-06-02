-- 把现存 status='converted' 的 Requirement 行规范化为 'delivering'。
-- 背景：v0.3.x 老枚举遗留；新枚举为 draft / analyzed / delivering / delivered / deferred / cancelled，不再使用 converted。
-- 见 spec docs/.ccb/specs/active/2026-05-10-requirements-page-ux-grouped-tabs.md follow-up requirement-status-enum-cleanup。
UPDATE "Requirement" SET "status" = 'delivering' WHERE "status" = 'converted';
