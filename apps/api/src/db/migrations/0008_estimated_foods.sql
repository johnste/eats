ALTER TABLE "foods" ADD COLUMN "estimated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Before this column, an agent logging a guess said so in the name:
-- "Ballerinakaka (estimated)", "Cheddar (Kvibille, uppskattad)". Move that
-- into the flag and out of the name. Same rules as stripEstimateMarker in
-- packages/shared/src/estimated.ts: only a whole comma-separated item inside
-- brackets counts, and the rest of the brackets are kept. Custom foods only;
-- shared sources never carried the marker. Checked against the same names
-- as that function's tests before shipping.
UPDATE "foods" SET "estimated" = true
WHERE "source" = 'custom'
  AND "name" ~* '\(([^()]*,)?\s*(?:estimated|estimate|est\.?|uppskattad|uppskattat|uppskattade|uppskattning)\s*(,[^()]*)?\)';
--> statement-breakpoint
UPDATE "foods" SET "name" = btrim(regexp_replace(
  regexp_replace(regexp_replace(regexp_replace(regexp_replace("name",
    '\s*\(\s*(?:estimated|estimate|est\.?|uppskattad|uppskattat|uppskattade|uppskattning)\s*\)', '', 'gi'),
    '\(\s*(?:estimated|estimate|est\.?|uppskattad|uppskattat|uppskattade|uppskattning)\s*,\s*([^()]*\))', '(\1', 'gi'),
    '(\([^()]*?)\s*,\s*(?:estimated|estimate|est\.?|uppskattad|uppskattat|uppskattade|uppskattning)\s*\)', '\1)', 'gi'),
    '(\([^()]*?)\s*,\s*(?:estimated|estimate|est\.?|uppskattad|uppskattat|uppskattade|uppskattning)\s*(,[^()]*\))', '\1\2', 'gi'),
  '\s{2,}', ' ', 'g'))
WHERE "source" = 'custom' AND "estimated" = true;
