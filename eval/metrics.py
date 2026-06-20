"""
Scoring metrics for the Measure Synthesis Benchmark (MSB).
All functions take sets of patient_ids and return scalar scores.
"""
from __future__ import annotations
from typing import Sequence


def precision_recall_f1(
    predicted: Sequence[str], reference: Sequence[str]
) -> dict[str, float]:
    p = set(predicted)
    r = set(reference)
    tp = len(p & r)
    precision = tp / len(p) if p else 0.0
    recall = tp / len(r) if r else 0.0
    f1 = (2 * precision * recall / (precision + recall)) if (precision + recall) else 0.0
    return {"precision": precision, "recall": recall, "f1": f1}


def exclusion_accuracy(
    excluded_predicted: Sequence[str], excluded_reference: Sequence[str]
) -> float:
    """Fraction of reference-excluded patients that the system also excludes."""
    ref = set(excluded_reference)
    if not ref:
        return 1.0
    pred = set(excluded_predicted)
    return len(pred & ref) / len(ref)


def jaccard(set_a: Sequence[str], set_b: Sequence[str]) -> float:
    a, b = set(set_a), set(set_b)
    if not a and not b:
        return 1.0
    return len(a & b) / len(a | b)


def mean_pairwise_jaccard(run_results: list[Sequence[str]]) -> float:
    """Consistency across K runs: mean Jaccard over all pairs."""
    n = len(run_results)
    if n < 2:
        return 1.0
    scores = []
    for i in range(n):
        for j in range(i + 1, n):
            scores.append(jaccard(run_results[i], run_results[j]))
    return sum(scores) / len(scores)
