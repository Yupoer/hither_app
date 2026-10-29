import json
from copy import deepcopy
from pathlib import Path
import subprocess
import sys
import tempfile


SCRIPT = Path(__file__).resolve().with_name("verify-ios-ota-publication.py")
SOURCE = "a" * 40
GROUP = "d43fbe84-a532-4b3b-91ab-cf69d3b4536c"
UPDATE = "a723f44d-2dc7-49ab-b07b-f0d3563ab413"
BRANCH = "fdb9d41f-c394-4a0b-841a-4e4cbf2c4bdb"
MAPPING = json.dumps({"version": 0, "data": [{"branchId": BRANCH, "branchMappingLogic": "true"}]})


def run(stage, files, *extra):
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        paths = {}
        for name, value in files.items():
            paths[name] = root / name
            paths[name].write_text(json.dumps(value), encoding="utf-8")
        command = [sys.executable, str(SCRIPT), stage]
        for name, path in paths.items():
            command.extend(["--" + name, str(path)])
        command.extend(extra)
        if stage == "after":
            command.extend(["--receipt", str(root / "receipt.json")])
        result = subprocess.run(command, capture_output=True, text=True)
        receipt = json.loads((root / "receipt.json").read_text()) if (root / "receipt.json").exists() else None
        return result, receipt


channel = {"currentPage": {"name": "production", "isPaused": False, "branchMapping": MAPPING,
                           "updateBranches": [{"id": BRANCH, "name": "production",
                                               "updateGroups": []}]}}
published = [{"id": UPDATE, "group": GROUP, "branch": "production", "runtimeVersion": "0.1.13",
              "platform": "IOS", "gitCommitHash": SOURCE, "message": f"hither release {SOURCE}",
              "isRollBackToEmbedded": False}]
# channel:view retains the raw GraphQL branch object and Update[][] groups.
raw_ios = {**published[0], "branch": {"id": BRANCH, "name": "production"}}
channel["currentPage"]["updateBranches"][0]["updateGroups"] = [[raw_ios]]

result, _ = run("before", {"channel": channel})
assert result.returncode == 0, result.stderr
result, _ = run("published", {"published": published}, "--source-sha", SOURCE, "--runtime", "0.1.13")
assert result.returncode == 0 and result.stdout.strip() == GROUP, result.stderr
result, receipt = run("after", {"published": published, "view": published, "channel": channel},
                      "--source-sha", SOURCE, "--runtime", "0.1.13")
assert result.returncode == 0 and receipt["group"] == GROUP and receipt["iosUpdateId"] == UPDATE, result.stderr

android = {**raw_ios, "id": "46e781f0-5efc-4028-b84c-2fa87f30ae30",
           "platform": "ANDROID", "runtimeVersion": "android-runtime"}
mixed_channel = deepcopy(channel)
mixed_channel["currentPage"]["updateBranches"][0]["updateGroups"] = [[android, raw_ios]]
result, receipt = run("after", {"published": published, "view": published, "channel": mixed_channel},
                      "--source-sha", SOURCE, "--runtime", "0.1.13")
assert result.returncode == 0 and receipt["iosUpdateId"] == UPDATE, result.stderr

for changed in ({"id": "46e781f0-5efc-4028-b84c-2fa87f30ae30"},
                {"id": "invalid"}, {"id": None}, {"group": []}, {"group": "invalid"},
                {"runtimeVersion": "0.1.12"}, {"gitCommitHash": "b" * 40},
                {"message": "different"}, {"isRollBackToEmbedded": True},
                {"isRollBackToEmbedded": None}, {"platform": "OTHER"},
                {"branch": "production"}, {"branch": {"id": BRANCH, "name": "preview"}},
                {"branch": {"id": UPDATE, "name": "production"}}, {"branch": None}):
    wrong = deepcopy(channel)
    wrong["currentPage"]["updateBranches"][0]["updateGroups"] = [[{**raw_ios, **changed}]]
    result, receipt = run("after", {"published": published, "view": published, "channel": wrong},
                          "--source-sha", SOURCE, "--runtime", "0.1.13")
    assert result.returncode != 0 and receipt is None, changed
    assert "Traceback" not in result.stderr, (changed, result.stderr)

for groups in (None, {}, [raw_ios], [[]], [[None]], [[raw_ios, raw_ios]], [[android]],
               [[raw_ios, {**android, "group": UPDATE}]], [[raw_ios, "invalid"]],
               [[{**raw_ios, "id": BRANCH}], [raw_ios]]):
    wrong = deepcopy(channel)
    wrong["currentPage"]["updateBranches"][0]["updateGroups"] = groups
    result, receipt = run("after", {"published": published, "view": published, "channel": wrong},
                          "--source-sha", SOURCE, "--runtime", "0.1.13")
    assert result.returncode != 0 and receipt is None, groups
    assert "Traceback" not in result.stderr, result.stderr

for malformed in (None, [], "invalid", {"currentPage": None}, {"currentPage": []},
                  {"currentPage": {**channel["currentPage"], "updateBranches": [None]}},
                  {"currentPage": {**channel["currentPage"], "updateBranches": {}}}):
    result, _ = run("before", {"channel": malformed})
    assert result.returncode != 0 and "Traceback" not in result.stderr, result.stderr

for malformed in (None, [None], [[]], [{}], [{**published[0], "isRollBackToEmbedded": True}]):
    result, _ = run("published", {"published": malformed},
                    "--source-sha", SOURCE, "--runtime", "0.1.13")
    assert result.returncode != 0 and "Traceback" not in result.stderr, result.stderr

for bad_id in (None, True, [], {}, "invalid"):
    result, _ = run("published", {"published": [{**published[0], "id": bad_id}]},
                    "--source-sha", SOURCE, "--runtime", "0.1.13")
    assert result.returncode != 0 and "Traceback" not in result.stderr, result.stderr

rollback_readback = [{**published[0], "isRollBackToEmbedded": True}]
result, receipt = run("after", {"published": published, "view": rollback_readback, "channel": channel},
                      "--source-sha", SOURCE, "--runtime", "0.1.13")
assert result.returncode != 0 and receipt is None

wrong_source = [dict(published[0], gitCommitHash="b" * 40)]
result, _ = run("published", {"published": wrong_source}, "--source-sha", SOURCE, "--runtime", "0.1.13")
assert result.returncode != 0

wrong_runtime = [dict(published[0], runtimeVersion="0.1.12")]
result, _ = run("published", {"published": wrong_runtime}, "--source-sha", SOURCE, "--runtime", "0.1.13")
assert result.returncode != 0

wrong_channel = {"currentPage": {"name": "production", "isPaused": False,
                                 "branchMapping": MAPPING,
                                 "updateBranches": [{"id": BRANCH, "name": "preview", "updateGroups": []}]}}
result, _ = run("before", {"channel": wrong_channel})
assert result.returncode != 0

conditional_channel = {"currentPage": {**channel["currentPage"],
                                       "branchMapping": json.dumps({"version": 0, "data": [
                                           {"branchId": BRANCH, "branchMappingLogic": ["==", "platform", "ios"]}
                                       ]})}}
result, _ = run("before", {"channel": conditional_channel})
assert result.returncode != 0

stale_channel = {"currentPage": {"name": "production", "isPaused": False,
                                 "branchMapping": MAPPING,
                                 "updateBranches": [{"id": BRANCH, "name": "production", "updateGroups": []}]}}
result, receipt = run("after", {"published": published, "view": published, "channel": stale_channel},
                      "--source-sha", SOURCE, "--runtime", "0.1.13")
assert result.returncode != 0 and receipt is None

wrong_readback = [dict(published[0], id="46e781f0-5efc-4028-b84c-2fa87f30ae30")]
result, receipt = run("after", {"published": published, "view": wrong_readback, "channel": channel},
                      "--source-sha", SOURCE, "--runtime", "0.1.13")
assert result.returncode != 0 and receipt is None

print("iOS OTA publication readback checks passed")
