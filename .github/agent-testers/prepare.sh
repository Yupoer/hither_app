#!/usr/bin/env bash
# Run from a mobile-agent-testers checkout: adds Hither's personas, brief and
# results public key from the Hither checkout given as $1.
set -euo pipefail
src="$1/.github/agent-testers"
python3 - "$src/personas.json" <<'PY'
import json, sys
base = json.load(open("personas.json", encoding="utf-8"))
extra = json.load(open(sys.argv[1], encoding="utf-8"))
ids = {p["id"] for p in extra}
merged = [p for p in base if p["id"] not in ids] + extra
json.dump(merged, open("personas.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
PY
cp "$src/hither-brief.md" hither-brief.md
cp "$src/results_public.pem" results_public.pem
