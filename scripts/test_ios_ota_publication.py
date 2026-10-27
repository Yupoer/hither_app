import json
from pathlib import Path
import subprocess
import sys
import tempfile


SCRIPT = Path(__file__).resolve().with_name("verify-ios-ota-publication.py")
SOURCE = "a" * 40
GROUP = "d43fbe84-a532-4b3b-91ab-cf69d3b4536c"
UPDATE = "a723f44d-2dc7-49ab-b07b-f0d3563ab413"


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


channel = {"currentPage": {"name": "production", "isPaused": False,
                           "updateBranches": [{"name": "production", "updateGroups": [{"group": GROUP}]}]}}
published = [{"id": UPDATE, "group": GROUP, "branch": "production", "runtimeVersion": "0.1.13",
              "platform": "IOS", "gitCommitHash": SOURCE, "message": f"hither release {SOURCE}",
              "isRollBackToEmbedded": False}]

result, _ = run("before", {"channel": channel})
assert result.returncode == 0, result.stderr
result, _ = run("published", {"published": published}, "--source-sha", SOURCE, "--runtime", "0.1.13")
assert result.returncode == 0 and result.stdout.strip() == GROUP, result.stderr
result, receipt = run("after", {"published": published, "view": published, "channel": channel},
                      "--source-sha", SOURCE, "--runtime", "0.1.13")
assert result.returncode == 0 and receipt["group"] == GROUP and receipt["iosUpdateId"] == UPDATE, result.stderr

wrong_source = [dict(published[0], gitCommitHash="b" * 40)]
result, _ = run("published", {"published": wrong_source}, "--source-sha", SOURCE, "--runtime", "0.1.13")
assert result.returncode != 0

wrong_runtime = [dict(published[0], runtimeVersion="0.1.12")]
result, _ = run("published", {"published": wrong_runtime}, "--source-sha", SOURCE, "--runtime", "0.1.13")
assert result.returncode != 0

wrong_channel = {"currentPage": {"name": "production", "isPaused": False,
                                 "updateBranches": [{"name": "preview", "updateGroups": []}]}}
result, _ = run("before", {"channel": wrong_channel})
assert result.returncode != 0

stale_channel = {"currentPage": {"name": "production", "isPaused": False,
                                 "updateBranches": [{"name": "production", "updateGroups": []}]}}
result, receipt = run("after", {"published": published, "view": published, "channel": stale_channel},
                      "--source-sha", SOURCE, "--runtime", "0.1.13")
assert result.returncode != 0 and receipt is None

wrong_readback = [dict(published[0], id="46e781f0-5efc-4028-b84c-2fa87f30ae30")]
result, receipt = run("after", {"published": published, "view": wrong_readback, "channel": channel},
                      "--source-sha", SOURCE, "--runtime", "0.1.13")
assert result.returncode != 0 and receipt is None

print("iOS OTA publication readback checks passed")
