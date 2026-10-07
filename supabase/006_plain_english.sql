-- =====================================================================
-- Migration 006: plain-English explanations on approval cards.
-- Run AFTER 005. Additive only. Safe to run again.
-- =====================================================================
alter table approvals add column if not exists explain text;   -- beginner-friendly: what this is, what approving does, terms defined
