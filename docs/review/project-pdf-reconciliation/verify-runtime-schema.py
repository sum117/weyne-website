"""Verify which tables the shipped server code touches are actually created by the
production migration path (drizzle/canonical), using the live probe database."""
import re
import subprocess
from pathlib import Path

PROD_TABLES = set(
    subprocess.run(
        ["docker", "exec", "weyne-recon-pg", "psql", "-U", "recon", "-d", "recon", "-Atc",
         "select table_name from information_schema.tables where table_schema='public'"],
        capture_output=True, text=True,
    ).stdout.split()
)

SRC = Path("src")
pattern = re.compile(r"\b(?:FROM|JOIN|INTO|UPDATE)\s+([a-z_][a-z0-9_]*)\b", re.IGNORECASE)
KEYWORDS = {"select", "where", "values", "set", "on", "as", "lateral", "only", "unnest"}

missing = {}
for path in SRC.rglob("*.ts"):
    if ".test." in path.name:
        continue
    text = path.read_text(encoding="utf-8", errors="ignore")
    for name in pattern.findall(text):
        low = name.lower()
        if low in KEYWORDS or low in PROD_TABLES:
            continue
        missing.setdefault(low, set()).add(str(path))

print("Production schema tables:", len(PROD_TABLES))
print()
print("Table names used in raw SQL by shipped server code but ABSENT from the production schema:")
for name in sorted(missing):
    files = sorted(missing[name])
    print(f"  {name}")
    for f in files:
        print(f"      {f}")
