-- Add title and relationship columns to User model
ALTER TABLE "User" ADD COLUMN "title" VARCHAR(255);
ALTER TABLE "User" ADD COLUMN "relationship" VARCHAR(50);
