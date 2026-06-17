-- backend/migrations/0003_add_volunteer_fields.sql

ALTER TABLE applicants
ADD COLUMN has_volunteer_experience BOOLEAN;

ALTER TABLE applicants
ADD COLUMN volunteer_experience TEXT;
