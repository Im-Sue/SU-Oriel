ALTER TABLE "Requirement" ADD COLUMN "verbatimSource" TEXT DEFAULT NULL;
ALTER TABLE "Requirement" ADD COLUMN "claudeInterpretation" TEXT DEFAULT NULL;
ALTER TABLE "Requirement" ADD COLUMN "ambiguities" TEXT DEFAULT NULL;
ALTER TABLE "Requirement" ADD COLUMN "fidelityDiff" TEXT DEFAULT NULL;
