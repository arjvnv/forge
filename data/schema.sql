-- Forge: Synthea domain data schema (locked at hour 0)
-- Both Forge build loop and eval reference implementations read from these tables.
-- Field names must not drift between systems.

CREATE TABLE IF NOT EXISTS patients (
    id          TEXT PRIMARY KEY,
    birthdate   DATE NOT NULL,
    deathdate   DATE,
    gender      TEXT NOT NULL   -- 'M' | 'F'
);

CREATE TABLE IF NOT EXISTS conditions (
    id          TEXT PRIMARY KEY,
    patient_id  TEXT NOT NULL REFERENCES patients(id),
    code        TEXT NOT NULL,  -- SNOMED or ICD-10 code
    description TEXT,
    start       DATE NOT NULL,
    stop        DATE            -- NULL = ongoing
);

CREATE TABLE IF NOT EXISTS observations (
    id          TEXT PRIMARY KEY,
    patient_id  TEXT NOT NULL REFERENCES patients(id),
    code        TEXT NOT NULL,  -- LOINC code
    description TEXT,
    value       NUMERIC,        -- numeric result (A1c %, BP mmHg, etc.)
    units       TEXT,
    date        DATE NOT NULL
);

CREATE TABLE IF NOT EXISTS encounters (
    id          TEXT PRIMARY KEY,
    patient_id  TEXT NOT NULL REFERENCES patients(id),
    start       TIMESTAMP NOT NULL,
    stop        TIMESTAMP
);

CREATE TABLE IF NOT EXISTS medications (
    id          TEXT PRIMARY KEY,
    patient_id  TEXT NOT NULL REFERENCES patients(id),
    code        TEXT NOT NULL,
    description TEXT,
    start       DATE NOT NULL,
    stop        DATE
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_conditions_patient    ON conditions(patient_id);
CREATE INDEX IF NOT EXISTS idx_conditions_code       ON conditions(code);
CREATE INDEX IF NOT EXISTS idx_observations_patient  ON observations(patient_id);
CREATE INDEX IF NOT EXISTS idx_observations_code     ON observations(code);
CREATE INDEX IF NOT EXISTS idx_observations_date     ON observations(date);
CREATE INDEX IF NOT EXISTS idx_encounters_patient    ON encounters(patient_id);
CREATE INDEX IF NOT EXISTS idx_medications_patient   ON medications(patient_id);
