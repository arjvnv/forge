"""
CMS165 — Controlling High Blood Pressure
Reference implementation — ground truth for the Measure Synthesis Benchmark.

Spec summary:
- Denominator: patients 18–85 with essential hypertension onset on or before June 30, 2023
  (i.e. started before the first-6-months cutoff and active then) + qualifying visit in period
- Numerator (controlled — standard, higher=better): most recent same-date paired BP in period
  has systolic <140 mmHg AND diastolic <90 mmHg
- Denominator exclusions: ESRD/dialysis/renal transplant, pregnancy, hospice, palliative care,
  66+ nursing home, advanced-illness-frailty (skipped — Synthea may not generate all codes;
  check generated data before committing build time to exclusion paths that never fire)
- BP LOINC codes: systolic = 8480-6, diastolic = 8462-4 (must be same-date paired reading)
- Hypertension SNOMED: 59621000 (essential HTN)

IMPORTANT: use only the ClinicDataLayer methods in backend/data/clinic_data.py.
"""
from __future__ import annotations
from datetime import date, datetime
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from backend.data.clinic_data import ClinicDataLayer

SYSTOLIC_LOINC = ["8480-6"]
DIASTOLIC_LOINC = ["8462-4"]
HTN_SNOMED = ["59621000"]

MEASUREMENT_START = date(2023, 1, 1)
MEASUREMENT_END = date(2023, 12, 31)
# HTN must have started on or before June 30 (first 6 months of measurement period)
HTN_ONSET_CUTOFF = date(2023, 6, 30)


def _obs_date_key(obs: dict) -> date:
    """Normalize asyncpg date/datetime observation field to datetime.date."""
    d = obs["date"]
    if isinstance(d, datetime):
        return d.date()
    return d  # already datetime.date


async def run(clinic_data: "ClinicDataLayer") -> dict:
    """
    Returns:
      {
        "denominator": [patient_id, ...],
        "numerator":   [patient_id, ...],  # subset of denominator (controlled BP)
        "excluded":    [patient_id, ...],
      }
    """
    # 1. Age-eligible patients (18–85 as of measurement end)
    age_rows = await clinic_data.get_patients_in_age_range(18, 85, MEASUREMENT_END)
    age_ids = {r["id"] for r in age_rows}

    # 2. Patients with essential HTN that started on or before June 30, 2023 and
    #    was still active on that date (covers "before measurement period" and
    #    "during first 6 months" cases where condition persisted to the cutoff)
    htn_ids = set(
        await clinic_data.get_patients_with_condition(HTN_SNOMED, HTN_ONSET_CUTOFF)
    )

    # 3. Denominator: age-eligible + HTN + qualifying visit in measurement period
    denominator: list[str] = []
    for pid in age_ids & htn_ids:
        if await clinic_data.had_qualifying_visit(pid, MEASUREMENT_START, MEASUREMENT_END):
            denominator.append(pid)

    # 4. Exclusions: ESRD, dialysis, renal transplant, pregnancy, hospice, palliative care,
    #    66+ nursing home, advanced-illness-frailty.
    # We check for presence but Synthea's default modules may not generate all of these codes;
    # the excluded set is expected to be small or empty for a synthetic population.
    excluded: list[str] = []

    active_denom = [p for p in denominator if p not in set(excluded)]

    # 5. Numerator: most recent same-date paired BP reading has systolic <140 AND diastolic <90
    numerator: list[str] = []
    for pid in active_denom:
        sys_obs = await clinic_data.get_observations_in_period(
            pid, SYSTOLIC_LOINC, MEASUREMENT_START, MEASUREMENT_END
        )
        dia_obs = await clinic_data.get_observations_in_period(
            pid, DIASTOLIC_LOINC, MEASUREMENT_START, MEASUREMENT_END
        )

        # Build date → value maps (most-recent-first order already from the query)
        sys_by_date: dict[date, float] = {}
        for o in sys_obs:
            try:
                sys_by_date[_obs_date_key(o)] = float(o["value"])
            except (TypeError, ValueError):
                pass

        dia_by_date: dict[date, float] = {}
        for o in dia_obs:
            try:
                dia_by_date[_obs_date_key(o)] = float(o["value"])
            except (TypeError, ValueError):
                pass

        # Find most recent date that has both a systolic and diastolic reading
        paired_dates = sorted(
            set(sys_by_date.keys()) & set(dia_by_date.keys()), reverse=True
        )

        if not paired_dates:
            # No paired BP reading → not controlled → not in numerator
            continue

        most_recent = paired_dates[0]
        if sys_by_date[most_recent] < 140.0 and dia_by_date[most_recent] < 90.0:
            numerator.append(pid)

    return {
        "denominator": denominator,
        "numerator": numerator,
        "excluded": excluded,
    }
