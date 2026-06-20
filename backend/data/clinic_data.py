"""
Typed data access layer over the Synthea Postgres tables.
Generated capability logic calls these functions — never raw SQL.
This is the declared surface area for 'reads' in manifests.
"""
from __future__ import annotations
import asyncpg
from datetime import date
from typing import Optional


class ClinicDataLayer:
    def __init__(self, db_url: str):
        self._db_url = db_url.replace("postgresql://", "postgresql://")
        self._pool: Optional[asyncpg.Pool] = None

    async def connect(self):
        self._pool = await asyncpg.create_pool(self._db_url, min_size=2, max_size=10)

    async def close(self):
        if self._pool:
            await self._pool.close()

    # ── patients ───────────────────────────────────────────────────────────

    async def get_patients_in_age_range(
        self, min_age: int, max_age: int, as_of: date
    ) -> list[dict]:
        """Return patients whose age on `as_of` is in [min_age, max_age]."""
        sql = """
            SELECT id, birthdate, deathdate, gender
            FROM patients
            WHERE
                (deathdate IS NULL OR deathdate > $3)
                AND DATE_PART('year', AGE($3, birthdate)) BETWEEN $1 AND $2
        """
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(sql, min_age, max_age, as_of)
        return [dict(r) for r in rows]

    # ── conditions ─────────────────────────────────────────────────────────

    async def get_patients_with_condition(
        self,
        codes: list[str],
        on_or_before: date,
        description_hint: str = "",
    ) -> list[str]:
        """Return patient_ids with any of the given condition codes active on or before `on_or_before`."""
        sql = """
            SELECT DISTINCT patient_id
            FROM conditions
            WHERE code = ANY($1)
              AND start <= $2
              AND (stop IS NULL OR stop > $2)
        """
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(sql, codes, on_or_before)
        return [r["patient_id"] for r in rows]

    async def patient_has_condition(
        self, patient_id: str, codes: list[str], on_or_before: date
    ) -> bool:
        sql = """
            SELECT 1 FROM conditions
            WHERE patient_id = $1 AND code = ANY($2)
              AND start <= $3 AND (stop IS NULL OR stop > $3)
            LIMIT 1
        """
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(sql, patient_id, codes, on_or_before)
        return row is not None

    # ── observations ───────────────────────────────────────────────────────

    async def get_most_recent_observation(
        self,
        patient_id: str,
        loinc_codes: list[str],
        within_period_start: date,
        within_period_end: date,
    ) -> Optional[dict]:
        """Return the most recent observation matching the LOINC codes within the measurement period."""
        sql = """
            SELECT id, code, value, units, date
            FROM observations
            WHERE patient_id = $1
              AND code = ANY($2)
              AND date BETWEEN $3 AND $4
            ORDER BY date DESC
            LIMIT 1
        """
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(sql, patient_id, loinc_codes, within_period_start, within_period_end)
        return dict(row) if row else None

    async def get_observations_in_period(
        self,
        patient_id: str,
        loinc_codes: list[str],
        period_start: date,
        period_end: date,
    ) -> list[dict]:
        sql = """
            SELECT id, code, value, units, date
            FROM observations
            WHERE patient_id = $1 AND code = ANY($2)
              AND date BETWEEN $3 AND $4
            ORDER BY date DESC
        """
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(sql, patient_id, loinc_codes, period_start, period_end)
        return [dict(r) for r in rows]

    # ── encounters ─────────────────────────────────────────────────────────

    async def had_qualifying_visit(
        self, patient_id: str, period_start: date, period_end: date
    ) -> bool:
        sql = """
            SELECT 1 FROM encounters
            WHERE patient_id = $1
              AND DATE(start) BETWEEN $2 AND $3
            LIMIT 1
        """
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(sql, patient_id, period_start, period_end)
        return row is not None

    async def get_encounters_in_period(
        self, patient_id: str, period_start: date, period_end: date
    ) -> list[dict]:
        sql = """
            SELECT id, start, stop FROM encounters
            WHERE patient_id = $1 AND DATE(start) BETWEEN $2 AND $3
        """
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(sql, patient_id, period_start, period_end)
        return [dict(r) for r in rows]

    # ── medications ────────────────────────────────────────────────────────

    async def patient_has_medication(
        self, patient_id: str, codes: list[str], on_or_before: date
    ) -> bool:
        sql = """
            SELECT 1 FROM medications
            WHERE patient_id = $1 AND code = ANY($2)
              AND start <= $3 AND (stop IS NULL OR stop > $3)
            LIMIT 1
        """
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(sql, patient_id, codes, on_or_before)
        return row is not None

    # ── convenience: all patients ──────────────────────────────────────────

    async def get_all_patient_ids(self) -> list[str]:
        async with self._pool.acquire() as conn:
            rows = await conn.fetch("SELECT id FROM patients WHERE deathdate IS NULL")
        return [r["id"] for r in rows]
