ALTER TABLE "api_tokens" DROP CONSTRAINT "api_tokens_token_hash_unique";--> statement-breakpoint
ALTER TABLE "api_tokens" ADD COLUMN "hint" text DEFAULT '' NOT NULL;--> statement-breakpoint
-- Secrets are argon2id from here on. Any row written before this point holds a
-- SHA-256 digest that can never verify again, so retire it rather than leaving
-- a token in the list that silently refuses to work.
UPDATE "api_tokens" SET "revoked_at" = now() WHERE "revoked_at" IS NULL AND "token_hash" NOT LIKE '$argon2%';
