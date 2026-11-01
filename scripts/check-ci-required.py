import json
import os
import sys


def check(needs):
    if needs["scope"]["result"] != "success":
        raise ValueError("scope must succeed")
    product = needs["scope"]["outputs"]["product"]
    if product not in {"true", "false"}:
        raise ValueError("scope product must be exactly true or false")
    outputs = needs["scope"]["outputs"]
    expected = json.loads(outputs["expected_jobs"])
    jobs = set(needs) - {"scope"}
    if not isinstance(expected, dict) or set(expected) != jobs or not jobs:
        raise ValueError("expected_jobs must name exactly every required job")
    if any(type(value) is not bool for value in expected.values()):
        raise ValueError("expected_jobs values must be booleans")
    mode = outputs["mode"]
    if mode not in {"docs", "full", "selective"}:
        raise ValueError("scope mode must be docs, full or selective")
    if product == "false":
        if mode != "docs" or any(expected.values()):
            raise ValueError("documentation scope must skip every product job")
    elif mode == "docs" or not expected.get("verify") or (mode == "full" and not all(expected.values())):
        raise ValueError("product scope requires verify and every job in full mode")
    for job, selected in expected.items():
        result = "success" if selected else "skipped"
        if needs[job]["result"] != result:
            raise ValueError(f"{job} must be {result}")


if __name__ == "__main__":
    try:
        check(json.loads(os.environ["CI_NEEDS"]))
    except (KeyError, TypeError, ValueError) as error:
        sys.exit(f"CI required failed: {error}")
    print("CI required passed")
