import copy
import importlib.util
import itertools
import json
import os
from pathlib import Path
import subprocess
import sys


script = Path(__file__).with_name("check-ci-required.py").resolve()
spec = importlib.util.spec_from_file_location("required", script)
required = importlib.util.module_from_spec(spec)
spec.loader.exec_module(required)
jobs = ("verify", "backend", "jsi-ui-runtime", "jsi-ios27-runtime")


def outcome(product, results):
    return {"scope": {"result": "success", "outputs": {"product": product}},
            **{job: {"result": result} for job, result in zip(jobs, results)}}


for product in ("true", "false", "", "True", "unknown", True, None):
    for results in itertools.product(("success", "skipped", "failure", "cancelled", "unknown", None), repeat=4):
        expected = product == "true" and set(results) == {"success"} or product == "false" and set(results) == {"skipped"}
        try:
            required.check(outcome(product, results))
            accepted = True
        except (KeyError, TypeError, ValueError):
            accepted = False
        assert accepted == expected, (product, results)

valid = outcome("true", ["success"] * 4)
invalid = [{}, [], None]
for job in ("scope", *jobs):
    missing = copy.deepcopy(valid)
    del missing[job]
    invalid.append(missing)
for result in ("failure", "cancelled", "skipped", "unknown", None):
    failed_scope = copy.deepcopy(valid)
    failed_scope["scope"]["result"] = result
    invalid.append(failed_scope)
for payload in [valid, outcome("false", ["skipped"] * 4), *invalid]:
    result = subprocess.run([sys.executable, "-B", str(script)], env={**os.environ, "CI_NEEDS": json.dumps(payload)}, capture_output=True)
    assert (result.returncode == 0) == (payload in [valid, outcome("false", ["skipped"] * 4)]), result
result = subprocess.run([sys.executable, "-B", str(script)], env={**os.environ, "CI_NEEDS": "not json"}, capture_output=True)
assert result.returncode != 0
print("CI required checks passed")
