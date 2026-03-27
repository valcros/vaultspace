-- Add title and relationship columns to users table
ALTER TABLE "users" ADD COLUMN "title" VARCHAR(255);
ALTER TABLE "users" ADD COLUMN "relationship" VARCHAR(50);
