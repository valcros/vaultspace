-- Add SKIPPED to ScanStatus: a file that was ALLOWED but not virus-scanned
-- (e.g. it exceeds the scanner's max scan size). Previously such files were
-- marked INFECTED and quarantined, which false-positive-blocked legitimate
-- large uploads (e.g. video).
ALTER TYPE "ScanStatus" ADD VALUE IF NOT EXISTS 'SKIPPED';
