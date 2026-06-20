"""
CMS165 — Controlling High Blood Pressure
Reference implementation — ground truth for the Measure Synthesis Benchmark.

Steven: implement run() against the ClinicDataLayer.
The output must match the MeasureResult schema in backend/schemas.py.

Spec summary:
- Denominator: patients 18–85 with essential hypertension diagnosis starting before or in
  first 6 months of measurement period + qualifying visit
- Numerator (controlled — standard, higher=better): most recent BP in period has
  systolic <140 mmHg AND diastolic <90 mmHg
- Denominator exclusions: ESRD/dialysis/renal transplant, pregnancy, hospice, palliative care,
  66+ in long-term nursing home, advanced-illness-frailty for 66–80 (skip if data absent)
- BP LOINC codes: systolic = 8480-6, diastolic = 8462-4 (must be same-date paired reading)
- Hypertension SNOMED: 59621000 (essential HTN) — use description ILIKE '%hypertension%' as fallback

IMPORTANT: use only the ClinicDataLayer methods in backend/data/clinic_data.py.
"""
from __future__ import annotations
from datetime import date
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from backend.data.clinic_data import ClinicDataLayer

SYSTOLIC_LOINC = ["8480-6"]
DIASTOLIC_LOINC = ["8462-4"]
HTN_SNOMED = ["59621000"]

MEASUREMENT_START = date(2023, 1, 1)
MEASUREMENT_END = date(2023, 12, 31)
HTN_ONSET_CUTOFF = date(2023, 7, 1)  # must start before first 6 months


async def run(clinic_data: "ClinicDataLayer") -> dict:
    """
    Returns:
      {
        "denominator": [patient_id, ...],
        "numerator":   [patient_id, ...],  # subset of denominator (controlled BP)
        "excluded":    [patient_id, ...],
      }
    """
    # TODO (Steven): implement per the spec above
    raise NotImplementedError("Steven: implement CMS165 reference logic")
