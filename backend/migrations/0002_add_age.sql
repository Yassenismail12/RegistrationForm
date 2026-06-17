-- backend/migrations/0001_create_applicants.sql

CREATE TABLE IF NOT EXISTS applicants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL,
    national_id TEXT NOT NULL UNIQUE,
    whatsapp TEXT NOT NULL,
    email TEXT,
    governorate TEXT,
    university TEXT,
    faculty TEXT,
    study_year TEXT,
    how_know_about_us TEXT,
    egyptian BOOLEAN NOT NULL DEFAULT 1,
    submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    source TEXT DEFAULT 'Cloudflare-Worker'
);

CREATE INDEX IF NOT EXISTS idx_applicants_national_id
ON applicants(national_id);