ALTER TABLE "Requirement" ADD COLUMN "analysisInputHash" TEXT;
ALTER TABLE "Requirement" ADD COLUMN "analysisStaleAt" DATETIME;

-- SQLite in this project runtime does not provide sha256/sha3 scalar functions.
-- Baseline backfill for existing rows is performed by scripts/ensure_dev_db.py
-- and by create/reanalyze runtime paths using Node/Python crypto.
