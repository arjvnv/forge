"""
CMS122 — Diabetes: Hemoglobin A1c (HbA1c) Poor Control (>9%)
Reference implementation — ground truth for the Measure Synthesis Benchmark.

Spec summary:
- Denominator: patients 18–75 with diabetes diagnosis + qualifying visit in measurement period
- Numerator (poor control — inverse measure): most recent A1c >9% OR no A1c in measurement period
- Denominator exclusions: 66+ in long-term nursing home >90 days (skipped — Synthea default
  modules do not reliably generate nursing-home institutional codes; exclusion set will be empty)
- A1c LOINC codes: 4548-4, 4549-2, 17856-6
- Diabetes SNOMED: 44054006 (Type 2), 73211009, 46635009 (Type 1)

IMPORTANT: use only the ClinicDataLayer methods in backend/data/clinic_data.py.
"""
from __future__ import annotations
from datetime import date
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from backend.data.clinic_data import ClinicDataLayer

A1C_LOINC = ["4548-4", "4549-2", "17856-6"]
DIABETES_SNOMED = ["44054006", "73211009", "46635009"]

# Measurement period — must match eval harness
MEASUREMENT_START = date(2023, 1, 1)
MEASUREMENT_END = date(2023, 12, 31)


async def run(clinic_data: "ClinicDataLayer") -> dict:
    """
    Returns:
      {
        "denominator": [patient_id, ...],
        "numerator":   [patient_id, ...],  # subset of denominator (poor control)
        "excluded":    [patient_id, ...],
      }
    """
    # 1. Age-eligible patients (18–75 as of measurement end)
    age_rows = await clinic_data.get_patients_in_age_range(18, 75, MEASUREMENT_END)
    age_ids = {r["id"] for r in age_rows}

    # 2. Patients with an active diabetes diagnosis by end of measurement period
    diabetes_ids = set(
        await clinic_data.get_patients_with_condition(DIABETES_SNOMED, MEASUREMENT_END)
    )

    # 3. Denominator: age-eligible + diabetes + qualifying visit in period
    denominator: list[str] = []
    for pid in age_ids & diabetes_ids:
        if await clinic_data.had_qualifying_visit(pid, MEASUREMENT_START, MEASUREMENT_END):
            denominator.append(pid)

    # 4. Exclusions: 66+ long-term nursing home >90 days
    # Synthea default modules do not generate reliable nursing-home institutional codes,
    # so we skip this check and expect an empty exclusion set in practice.
    excluded: list[str] = []

    active_denom = [p for p in denominator if p not in set(excluded)]

    # 5. Numerator (poor control — inverse measure):
    #    most recent A1c in period >9% OR no A1c performed in period
    numerator: list[str] = []
    for pid in active_denom:
        obs = await clinic_data.get_most_recent_observation(
            pid, A1C_LOINC, MEASUREMENT_START, MEASUREMENT_END
        )
        if obs is None:
            # No A1c performed → poor control
            numerator.append(pid)
        else:
            try:
                if float(obs["value"]) > 9.0:
                    numerator.append(pid)
            except (TypeError, ValueError):
                # Unparseable value → treat as missing → poor control
                numerator.append(pid)

    return {
        "denominator": denominator,
        "numerator": numerator,
        "excluded": excluded,
    }
