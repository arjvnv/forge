"""
CMS122 — Diabetes: Hemoglobin A1c (HbA1c) Poor Control (>9%)
Reference implementation — ground truth for the Measure Synthesis Benchmark.

Steven: implement run() against the ClinicDataLayer.
The output must match the MeasureResult schema in backend/schemas.py.

Spec summary:
- Denominator: patients 18–75 with diabetes diagnosis + qualifying visit in measurement period
- Numerator (poor control — inverse measure): most recent A1c >9% OR no A1c in measurement period
- Denominator exclusions: 66+ in long-term nursing home >90 days (simplify: skip if Synthea
  doesn't generate those conditions; check data first)
- A1c LOINC codes: 4548-4, 4549-2, 17856-6
- Diabetes SNOMED: 44054006 (Type 2), 73211009, 46635009 (Type 1) — use description ILIKE '%diabetes%' as fallback

IMPORTANT: use only the ClinicDataLayer methods in backend/data/clinic_data.py.
"""
from __future__ import annotations
from datetime import date
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from backend.data.clinic_data import ClinicDataLayer

A1C_LOINC = ["4548-4", "4549-2", "17856-6"]
DIABETES_SNOMED = ["44054006", "73211009", "46635009"]

# measurement period — must match eval harness
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
    # TODO (Steven): implement per the spec above
    raise NotImplementedError("Steven: implement CMS122 reference logic")
