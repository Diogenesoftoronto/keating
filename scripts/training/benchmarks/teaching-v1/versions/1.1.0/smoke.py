"""Run three structural probes against the retained v1.1 checker, offline."""
import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile


HERE = Path(__file__).resolve().parent
REPO = HERE.parents[5]
SUITE = "scripts/training/benchmarks/teaching-v1/"
ARCHIVE_SHA256 = "91673f5bcabb680b397c742530d42b08b564172cf397f6f05ea47954517e4197"
RELEASE_DELTA_SHA256 = "3efe952422349a7cf8b53ca039621b9b07450be4f02271bd40679b7c0806d4ec"


def archive_contents(name, expected_digest):
    archive = (HERE / name).read_bytes()
    if hashlib.sha256(archive).hexdigest() != expected_digest:
        raise ValueError(f"Frozen v1.1 archive digest mismatch in {name}")
    return json.loads(gzip.decompress(archive))


def restore_files(root, snapshot):
    files = archive_contents("frozen-checker.json.gz", ARCHIVE_SHA256)
    if snapshot == "4.2.0":
        files.update(archive_contents("v4.2.0-delta.json.gz", RELEASE_DELTA_SHA256))
    for name, text in files.items():
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(text.encode("utf-8"))
    return json.loads(files[SUITE + "manifest.json"])


def provide_packages(root, packages):
    modules = root / "node_modules"
    for name, version in packages.items():
        candidates = (REPO / "web/node_modules" / name, REPO / "node_modules" / name)
        for candidate in candidates:
            metadata = candidate / "package.json"
            if metadata.is_file():
                info = json.loads(metadata.read_text())
                if info.get("name") == name and info.get("version") == version:
                    target = modules / name
                    target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copytree(candidate, target, ignore=shutil.ignore_patterns("node_modules"))
                    break
        else:
            raise ValueError(f"Offline v1.1 checker needs installed {name}@{version}")
    # Resolve the two workspace imports to the private tree, including the runtime
    # package whose root export is src/index.ts. Never use the live workspace code.
    scope = modules / "@keating"
    scope.mkdir()
    (scope / "learner-contracts").symlink_to(root / "packages/learner-contracts", target_is_directory=True)
    (scope / "runtime-config").symlink_to(root / "packages/runtime-config/src", target_is_directory=True)


def run_probes(root, run_bun, manifest):
    cases = {case["id"]: case for case in json.loads((root / SUITE / "cases.json").read_text())["cases"]}
    question = next(message["content"] for message in cases["stuck-closure"]["messages"]
                    if message["role"] == "assistant" and "```openui" in message["content"])
    probes = [("direct-const", "The binding keeps its assigned value."),
              ("predict-event-loop", question), ("predict-event-loop", "Plain text only.")]
    inputs = [{"case": cases[case_id], "response": {"content": text, "tool_calls": [], "finish_reason": "stop"}}
              for case_id, text in probes]
    (root / "input.json").write_text(json.dumps(inputs))
    run_bun(manifest["contract_checker"]["path"], "input.json", "output.json")
    results = json.loads((root / "output.json").read_text())
    outcomes = [(row["id"], row["contract_passed"], len(row["openui"]["actions"])) for row in results]
    if outcomes != [("direct-const", True, 0), ("predict-event-loop", True, 1), ("predict-event-loop", False, 0)]:
        raise ValueError(f"Unexpected v1.1 contract outcomes: {outcomes!r}")
    print(json.dumps([{"case": name, "contractPassed": passed, "executedActions": actions}
                      for name, passed, actions in outcomes]))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snapshot", choices=("original", "4.2.0"), default="original",
                        help="Select the v1.1 checker as first recorded or as distributed with Keating 4.2.0.")
    parser.add_argument("--inventory", action="store_true",
                        help="Also attempt the original bundler inventory of its declared files.")
    options = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="keating-v11-checker-") as temporary:
        root = Path(temporary)
        manifest = restore_files(root, options.snapshot)
        env = {key: os.environ[key] for key in ("PATH", "LANG", "LC_ALL", "LD_LIBRARY_PATH") if key in os.environ}
        env.update(BUN_INSTALL_CACHE_DIR=str(root / "offline-cache"), HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1")

        def run_bun(*args, output=False):
            return subprocess.run(["rtk", "proxy", "bun", "--no-install", *args], cwd=root, env=env,
                                  stdout=subprocess.PIPE if output else None, check=True, timeout=120)

        runtime = run_bun("-e", "console.log(JSON.stringify({name:'bun',version:Bun.version,revision:Bun.revision}))",
                          output=True)
        if json.loads(runtime.stdout) != manifest["contract_runtime"]:
            raise ValueError("The installed Bun revision differs from the v1.1 freeze")
        provide_packages(root, manifest["contract_packages"])
        run_probes(root, run_bun, manifest)
        if options.inventory:
            actual = json.loads(run_bun(manifest["contract_inventory"]["path"], output=True).stdout)
            for field in ("contract_sources", "contract_runtime", "contract_packages"):
                if actual.get(field) != manifest[field]:
                    raise ValueError(f"The restored inventory differs at {field}")


if __name__ == "__main__":
    main()
