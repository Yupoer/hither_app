import copy
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys

script = Path(__file__).with_name("check-ci-required.py").resolve()
spec = importlib.util.spec_from_file_location("required", script)
required = importlib.util.module_from_spec(spec)
spec.loader.exec_module(required)
jobs = ("verify", "mobile-checks", "backend", "jsi-ui-runtime", "jsi-ios27-runtime")


def outcome(mode, selected):
    expected = {job: job in selected for job in jobs}
    return {"scope": {"result": "success", "outputs": {
        "product": "false" if mode == "docs" else "true", "mode": mode,
        "expected_jobs": json.dumps(expected),
    }}, **{job: {"result": "success" if expected[job] else "skipped"} for job in jobs}}


def accepts(payload):
    try:
        required.check(payload)
        return True
    except (KeyError, TypeError, ValueError):
        return False


valid = [outcome("docs", []), outcome("full", jobs), outcome("selective", ["verify", "mobile-checks"])]
for payload in valid:
    assert accepts(payload)
    for job in jobs:
        for result in ("success", "skipped", "failure", "cancelled", "unknown", None):
            altered = copy.deepcopy(payload)
            altered[job]["result"] = result
            assert accepts(altered) == (result == payload[job]["result"]), (job, result)

invalid = [{}, [], None, outcome("full", ["verify"]), outcome("selective", ["mobile-checks"])]
for product in ("", "True", "unknown", True, None):
    altered = copy.deepcopy(valid[1]); altered["scope"]["outputs"]["product"] = product; invalid.append(altered)
for expected in ("not json", "null", "[]", "{}", json.dumps({job: 1 for job in jobs}), json.dumps({**{job: True for job in jobs}, "unknown": True})):
    altered = copy.deepcopy(valid[1]); altered["scope"]["outputs"]["expected_jobs"] = expected; invalid.append(altered)
for job in ("scope", *jobs):
    altered = copy.deepcopy(valid[1]); del altered[job]; invalid.append(altered)
for result in ("failure", "cancelled", "skipped", None):
    altered = copy.deepcopy(valid[1]); altered["scope"]["result"] = result; invalid.append(altered)
for mode in ("unknown", "docs", None):
    altered = copy.deepcopy(valid[1]); altered["scope"]["outputs"]["mode"] = mode; invalid.append(altered)
for payload in invalid:
    assert not accepts(payload), payload
for payload, expected in [(valid[1], 0), (invalid[3], 1)]:
    result = subprocess.run([sys.executable, "-B", str(script)], env={**os.environ, "CI_NEEDS": json.dumps(payload)}, capture_output=True)
    assert (result.returncode != 0) == bool(expected), result

workflow = script.parents[1].joinpath('.github/workflows/ci.yml').read_text(encoding='utf-8')
backend = re.search(r'(?ms)^  backend:\n(.*?)(?=^  \S|\Z)', workflow).group(1)
commands = {line.strip() for line in backend.splitlines()}
for command in (
    'node --test supabase/scripts/function-source-of-truth.test.mjs',
    'node supabase/scripts/function-source-of-truth.mjs --check',
    'node supabase/tests/promo_redemption_concurrency.mjs',
    'node supabase/tests/trip_storekit_refund_concurrency.mjs',
):
    assert command in commands, f'required backend gate missing: {command}'
assert '          node scripts/test-ci-meta.mjs' in workflow.splitlines(), 'CI metadata self-check missing'
print("CI required checks passed")
