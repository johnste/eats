ALTER TABLE "users" ADD COLUMN "use_off_barcode" boolean DEFAULT true NOT NULL;--> statement-breakpoint
-- Until now one switch covered Open Food Facts for both search and barcodes.
-- Start the new barcode switch where that one was, so nobody's scanner
-- changes behaviour until they choose otherwise.
UPDATE "users" SET "use_off_barcode" = "use_off";
