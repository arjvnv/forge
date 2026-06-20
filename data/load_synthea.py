"""
Load Synthea CSV output into the Forge Postgres schema.
Usage: python load_synthea.py --synthea-dir /path/to/synthea/output/csv
"""
import os
import sys
import uuid
import argparse
import pandas as pd
import psycopg2
from dotenv import load_dotenv

load_dotenv()

DB_URL = os.environ["DATABASE_URL"]


def connect():
    import psycopg2
    from urllib.parse import urlparse
    r = urlparse(DB_URL)
    return psycopg2.connect(
        dbname=r.path[1:], user=r.username, password=r.password,
        host=r.hostname, port=r.port or 5432
    )


def load_patients(conn, csv_dir: str):
    path = os.path.join(csv_dir, "patients.csv")
    df = pd.read_csv(path, dtype=str)
    df = df.rename(columns=str.lower)
    # Synthea column names
    rows = df[["id", "birthdate", "deathdate", "gender"]].copy()
    rows["birthdate"] = pd.to_datetime(rows["birthdate"], errors="coerce").dt.date
    rows["deathdate"] = pd.to_datetime(rows["deathdate"], errors="coerce").dt.date
    rows["gender"] = rows["gender"].str.upper().str[0]  # M / F
    with conn.cursor() as cur:
        for _, r in rows.iterrows():
            cur.execute(
                "INSERT INTO patients(id, birthdate, deathdate, gender) VALUES (%s,%s,%s,%s) ON CONFLICT DO NOTHING",
                (r.id, r.birthdate, r.deathdate if pd.notna(r.deathdate) else None, r.gender),
            )
    conn.commit()
    print(f"  patients: {len(rows)} rows")


def load_conditions(conn, csv_dir: str):
    path = os.path.join(csv_dir, "conditions.csv")
    df = pd.read_csv(path, dtype=str)
    df = df.rename(columns=str.lower)
    with conn.cursor() as cur:
        for _, r in df.iterrows():
            cur.execute(
                "INSERT INTO conditions(id, patient_id, code, description, start, stop) "
                "VALUES (%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING",
                (
                    str(uuid.uuid4()),
                    r.patient,
                    r.code,
                    r.get("description", ""),
                    pd.to_datetime(r.start, errors="coerce").date() if pd.notna(r.start) else None,
                    pd.to_datetime(r.stop, errors="coerce").date() if pd.notna(r.get("stop")) else None,
                ),
            )
    conn.commit()
    print(f"  conditions: {len(df)} rows")


def load_observations(conn, csv_dir: str):
    path = os.path.join(csv_dir, "observations.csv")
    df = pd.read_csv(path, dtype=str)
    df = df.rename(columns=str.lower)
    # Only load numeric observations we care about
    target_codes = {
        "4548-4", "4549-2", "17856-6",  # A1c
        "8480-6", "8462-4",              # BP systolic / diastolic
    }
    df = df[df["code"].isin(target_codes)].copy()
    with conn.cursor() as cur:
        for _, r in df.iterrows():
            try:
                val = float(r["value"]) if pd.notna(r.get("value")) else None
            except (ValueError, TypeError):
                val = None
            cur.execute(
                "INSERT INTO observations(id, patient_id, code, description, value, units, date) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING",
                (
                    str(uuid.uuid4()),
                    r.patient,
                    r.code,
                    r.get("description", ""),
                    val,
                    r.get("units", ""),
                    pd.to_datetime(r.date, errors="coerce").date(),
                ),
            )
    conn.commit()
    print(f"  observations (filtered): {len(df)} rows")


def load_encounters(conn, csv_dir: str):
    path = os.path.join(csv_dir, "encounters.csv")
    df = pd.read_csv(path, dtype=str)
    df = df.rename(columns=str.lower)
    with conn.cursor() as cur:
        for _, r in df.iterrows():
            cur.execute(
                "INSERT INTO encounters(id, patient_id, start, stop) VALUES (%s,%s,%s,%s) ON CONFLICT DO NOTHING",
                (
                    r.id,
                    r.patient,
                    pd.to_datetime(r.start, errors="coerce"),
                    pd.to_datetime(r.stop, errors="coerce") if pd.notna(r.get("stop")) else None,
                ),
            )
    conn.commit()
    print(f"  encounters: {len(df)} rows")


def load_medications(conn, csv_dir: str):
    path = os.path.join(csv_dir, "medications.csv")
    if not os.path.exists(path):
        print("  medications: file not found, skipping")
        return
    df = pd.read_csv(path, dtype=str)
    df = df.rename(columns=str.lower)
    with conn.cursor() as cur:
        for _, r in df.iterrows():
            cur.execute(
                "INSERT INTO medications(id, patient_id, code, description, start, stop) "
                "VALUES (%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING",
                (
                    str(uuid.uuid4()),
                    r.patient,
                    r.code,
                    r.get("description", ""),
                    pd.to_datetime(r.start, errors="coerce").date() if pd.notna(r.get("start")) else None,
                    pd.to_datetime(r.stop, errors="coerce").date() if pd.notna(r.get("stop")) else None,
                ),
            )
    conn.commit()
    print(f"  medications: {len(df)} rows")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--synthea-dir", required=True, help="Path to Synthea CSV output directory")
    args = parser.parse_args()

    print(f"Loading Synthea data from: {args.synthea_dir}")
    conn = connect()
    try:
        load_patients(conn, args.synthea_dir)
        load_conditions(conn, args.synthea_dir)
        load_observations(conn, args.synthea_dir)
        load_encounters(conn, args.synthea_dir)
        load_medications(conn, args.synthea_dir)
        print("Load complete.")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
