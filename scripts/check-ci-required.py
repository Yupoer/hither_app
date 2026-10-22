import json
import os
import sys


def check(needs):
    if needs["scope"]["result"] != "success":
        raise ValueError("scope must succeed")
    product = needs["scope"]["outputs"]["product"]
    if product not in {"true", "false"}:
        raise ValueError("scope product must be exactly true or false")
    expected = "success" if product == "true" else "skipped"
    for job in ("verify", "backend", "jsi-ui-runtime", "jsi-ios27-runtime"):
        if needs[job]["result"] != expected:
            raise ValueError(f"{job} must be {expected} for product={product}")


if __name__ == "__main__":
    try:
        check(json.loads(os.environ["CI_NEEDS"]))
    except (KeyError, TypeError, ValueError) as error:
        sys.exit(f"CI required failed: {error}")
    print("CI required passed")
