"""Check the release modes execute only their intended CD actions."""

from pathlib import Path
import json
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
    assert runs("Pin CocoaPods to checked-in lockfile", mode) == (mode in (
        "preflight", "validate-release", "build-only", "submit")), mode
    assert runs("Build and cold-launch full Release simulator app", mode) == (mode in ("validate-release", "build-only", "submit")), mode
    assert runs("Upload Release launch receipt", mode) == (mode in ("validate-release", "build-only", "submit")), mode
    diagnostic_condition = steps["Upload sanitized Release launch failure diagnostic"]["if"]
    assert "failure()" in diagnostic_condition
    assert (f"inputs.mode == '{mode}'" in diagnostic_condition) == (mode in (
        "validate-release", "build-only", "submit")), mode
    assert runs("Upload this IPA to TestFlight", mode) == (mode == "submit"), mode
    assert runs("Verify production release prerequisites", mode) == (mode in ("ota", "submit")), mode

ota_publish = steps["Publish and verify production iOS OTA"]["body"]
assert "env:exec production" in ota_publish
assert "EAS_BUILD_PROFILE=production npx --yes eas-cli@21.0.2 update" in ota_publish
assert "          EAS_BUILD_PROFILE: production" not in ota_publish
assert "EXUpdatesRequestHeaders" in steps["Verify IPA and record source"]["body"]
build_receipt = steps["Verify IPA and record source"]["body"]
assert "runtime=%s\\nchannel=%s\\n" in build_receipt
assert 'runtime=$(plutil -extract EXUpdatesRuntimeVersion raw "$app/Expo.plist")' in build_receipt
assert "assert updates.get('EXUpdatesRuntimeVersion') == config['runtimeVersion']" in build_receipt
assert "assert updates.get('EXUpdatesRequestHeaders', {}).get('expo-channel-name') == 'production'" in build_receipt
assert "    if: inputs.mode == 'inspect-release'" in source
assert "    if: inputs.mode != 'inspect-release'" in source
assert source.index("- name: Pin CocoaPods to checked-in lockfile") < source.index(
    "- name: Build and cold-launch full Release simulator app")

expo_steps = ("Read EAS production iOS metadata", "Publish and verify production iOS OTA",
              "Build and cold-launch full Release simulator app",
              "Build signed production IPA on this runner", "Upload this IPA to TestFlight")
for name in expo_steps:
    assert "EXPO_TOKEN: ${{ secrets.HITHER_GITHUB_ACTIONS }}" in steps[name]["body"], name
assert "secrets.EXPO_TOKEN" not in source

group_expression = re.search(r"^  group: (.+)$", source, flags=re.MULTILINE)[1]
serialized_modes = set(json.loads(re.search(r"fromJSON\('([^']+)'\)", group_expression)[1]))
mutation_modes = {"ota", "build-only", "submit"}
groups = {mode: "cd-ios-production" if mode in serialized_modes else "cd-ios-diagnostic-12345-1"
          for mode in ("inspect-release", "preflight", "validate-release", "ota", "build-only", "submit")}
assert {groups[mode] for mode in mutation_modes} == {"cd-ios-production"}
assert groups["validate-release"] == groups["ota"], groups
assert serialized_modes == mutation_modes | {"validate-release"}
assert all(groups[mode] != "cd-ios-production" for mode in ("inspect-release", "preflight"))
expected_group = "${{ contains(fromJSON('[\"ota\",\"build-only\",\"submit\",\"validate-release\"]'), inputs.mode) && 'cd-ios-production' || format('cd-ios-diagnostic-{0}-{1}', github.run_id, github.run_attempt) }}"
assert group_expression == expected_group

for prepare, upload, mutate, phase, step_id in (
        ("Prepare production iOS OTA intent", "Upload OTA mutation intent", "Publish and verify production iOS OTA", "ota_publication", "ota_intent_upload"),
        ("Prepare signed build intent", "Upload signed build mutation intent", "Build signed production IPA on this runner", "signed_build", "build_intent_upload"),
        ("Prepare TestFlight upload intent", "Upload TestFlight mutation intent", "Upload this IPA to TestFlight", "eas_upload", "submit_intent_upload")):
    assert source.index(f"- name: {prepare}") < source.index(f"- name: {upload}") < source.index(f"- name: {mutate}")
    body = steps[upload]["body"]
    assert "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02" in body
    assert f"hither-ios-cd-intent-${{{{ github.run_id }}}}-${{{{ github.run_attempt }}}}-{phase}" in body
    assert f"path: ${{{{ runner.temp }}}}/hither-ios-cd-intent-{phase}.json" in body
    assert "if-no-files-found: error" in body and "overwrite:" not in body
    assert f"INTENT_RETAINED: ${{{{ steps.{step_id}.outcome }}}}" in steps[mutate]["body"]

for name in ("Finalize inventory attempt outcome", "Finalize iOS attempt outcome",
             "Upload inventory attempt outcome", "Upload iOS attempt outcome", "Upload sanitized inventory receipt"):
    assert steps[name]["if"] == "always()", name
for guard, initialize, finalize in (
        ("Verify pinned inventory source", "Initialize inventory attempt journal", "Finalize inventory attempt outcome"),
        ("Verify pinned master source and Xcode", "Initialize iOS attempt journal", "Finalize iOS attempt outcome")):
    assert source.index(f"- name: {guard}") < source.index(f"- name: {initialize}")
    assert "id: trusted_source" in steps[guard]["body"]
    assert steps[initialize]["if"] is None
    assert "SOURCE_TRUSTED: ${{ steps.trusted_source.outcome }}" in steps[finalize]["body"]
assert "continue-on-error" not in source
assert "Hither-production.ipa" not in steps["Upload iOS attempt outcome"]["body"]

print("iOS CD route isolation checks passed")
