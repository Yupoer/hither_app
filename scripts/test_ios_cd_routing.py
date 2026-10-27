"""Check the release modes execute only their intended CD actions."""

from pathlib import Path
import re


workflow = Path(__file__).resolve().parents[1] / ".github/workflows/cd-ios-testflight.yml"
source = workflow.read_text(encoding="utf-8")
steps = {}
for block in re.split(r"(?=^      - (?:name:|uses:))", source, flags=re.MULTILINE):
    name = re.search(r"^      - name: (.+)$", block, flags=re.MULTILINE)
    if name:
        condition = re.search(r"^        if: (.+)$", block, flags=re.MULTILINE)
        steps[name.group(1)] = {"if": condition.group(1) if condition else None, "body": block}


def runs(name, mode):
    condition = steps[name]["if"]
    if condition is None:
        return True
    def evaluate(atom):
        match = re.fullmatch(r"inputs\.mode (==|!=) '([a-z-]+)'", atom)
        assert match, atom
        return (mode == match.group(2)) == (match.group(1) == "==")

    return any(all(evaluate(atom) for atom in clause.split(" && "))
               for clause in condition.split(" || "))


ota = ("Verify OTA compatibility and current master", "Publish and verify production iOS OTA",
       "Upload OTA receipt")
native = ("Build signed production IPA on this runner", "Verify IPA and record source",
          "Upload build receipt")

for mode in ("inspect-release", "ota", "preflight", "validate-release", "build-only", "submit"):
    assert all(runs(name, mode) == (mode == "ota") for name in ota), mode
    assert all(runs(name, mode) == (mode in ("build-only", "submit")) for name in native), mode
    assert runs("Build and cold-launch full Release simulator app", mode) == (mode in ("validate-release", "build-only", "submit")), mode
    assert runs("Upload Release launch receipt", mode) == (mode in ("validate-release", "build-only", "submit")), mode
    assert runs("Upload this IPA to TestFlight", mode) == (mode == "submit"), mode
    assert runs("Verify production release prerequisites", mode) == (mode in ("ota", "submit")), mode

ota_publish = steps["Publish and verify production iOS OTA"]["body"]
assert "env:exec production" in ota_publish
assert "EAS_BUILD_PROFILE=production npx --yes eas-cli@21.0.2 update" in ota_publish
assert "          EAS_BUILD_PROFILE: production" not in ota_publish
assert "EXUpdatesRequestHeaders" in steps["Verify IPA and record source"]["body"]
assert "    if: inputs.mode == 'inspect-release'" in source
assert "    if: inputs.mode != 'inspect-release'" in source

print("iOS CD route isolation checks passed")
