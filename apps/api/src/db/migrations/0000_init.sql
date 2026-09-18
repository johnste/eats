CREATE TYPE "public"."activity_level" AS ENUM('sedentary', 'light', 'moderate', 'active', 'very_active');--> statement-breakpoint
CREATE TYPE "public"."food_source" AS ENUM('off', 'custom');--> statement-breakpoint
CREATE TYPE "public"."meal" AS ENUM('breakfast', 'lunch', 'dinner', 'snack');--> statement-breakpoint
CREATE TYPE "public"."sex" AS ENUM('male', 'female');--> statement-breakpoint
CREATE TABLE "food_servings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"food_id" uuid NOT NULL,
	"label" text NOT NULL,
	"grams" real NOT NULL
);
--> statement-breakpoint
CREATE TABLE "foods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" "food_source" NOT NULL,
	"barcode" text,
	"name" text NOT NULL,
	"brand" text,
	"kcal_100g" real NOT NULL,
	"protein_100g" real NOT NULL,
	"carbs_100g" real NOT NULL,
	"fat_100g" real NOT NULL,
	"created_by" uuid,
	"off_fetched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "foods_source_barcode_uq" UNIQUE("source","barcode")
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"effective_from" date NOT NULL,
	"calories" integer NOT NULL,
	"protein_g" real NOT NULL,
	"carbs_g" real NOT NULL,
	"fat_g" real NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goals_user_date_uq" UNIQUE("user_id","effective_from")
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"code" text PRIMARY KEY NOT NULL,
	"created_by" uuid,
	"used_by" uuid,
	"used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "log_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"food_id" uuid NOT NULL,
	"logged_on" date NOT NULL,
	"meal" "meal" NOT NULL,
	"grams" real NOT NULL,
	"kcal" real NOT NULL,
	"protein_g" real NOT NULL,
	"carbs_g" real NOT NULL,
	"fat_g" real NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" text NOT NULL,
	"sex" "sex",
	"birth_date" date,
	"height_cm" real,
	"activity_level" "activity_level",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "weights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"measured_on" date NOT NULL,
	"weight_kg" real NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "weights_user_date_uq" UNIQUE("user_id","measured_on")
);
--> statement-breakpoint
ALTER TABLE "food_servings" ADD CONSTRAINT "food_servings_food_id_foods_id_fk" FOREIGN KEY ("food_id") REFERENCES "public"."foods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foods" ADD CONSTRAINT "foods_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_used_by_users_id_fk" FOREIGN KEY ("used_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "log_entries" ADD CONSTRAINT "log_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "log_entries" ADD CONSTRAINT "log_entries_food_id_foods_id_fk" FOREIGN KEY ("food_id") REFERENCES "public"."foods"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weights" ADD CONSTRAINT "weights_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "food_servings_food_idx" ON "food_servings" USING btree ("food_id");--> statement-breakpoint
CREATE INDEX "foods_name_idx" ON "foods" USING btree ("name");--> statement-breakpoint
CREATE INDEX "log_entries_user_date_idx" ON "log_entries" USING btree ("user_id","logged_on");--> statement-breakpoint
CREATE INDEX "log_entries_user_food_idx" ON "log_entries" USING btree ("user_id","food_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");