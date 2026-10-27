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
        steps[name.group(1)] = condition.group(1) if condition else None


def runs(name, mode):
    condition = steps[name]
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

for mode in ("ota", "preflight", "build-only", "submit"):
    assert all(runs(name, mode) == (mode == "ota") for name in ota), mode
    assert all(runs(name, mode) == (mode in ("build-only", "submit")) for name in native), mode
    assert runs("Upload this IPA to TestFlight", mode) == (mode == "submit"), mode
    assert runs("Verify production release prerequisites", mode) == (mode in ("ota", "submit")), mode

print("iOS CD route isolation checks passed")
