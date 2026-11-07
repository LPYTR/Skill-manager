"""Inspect local-to-cloud migration evidence without changing pet selection."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re


def resolve_home(value=None):
    return Path(value or os.environ.get("CODEX_HOME") or Path.home() / ".codex").expanduser().absolute()


def inspect_target(home, pet_id):
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,62}", pet_id):
        raise ValueError("Expected a local pet folder ID")
    path = resolve_home(home) / ".codex-global-state.json"
    result = {"local_pet_id": pet_id, "state_file": str(path), "status": "unknown",
              "cloud_pet_ids": [], "active_cloud_pet_ids": [],
              "migration_observed": False, "requested_pet_migrated": False,
              "route": "local-files", "live_playback_verified": False}
    try:
        state = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError) as error:
        result["reason"] = "No readable migration evidence: " + type(error).__name__
        return result
    atoms = state.get("electron-persisted-atom-state", {}) if isinstance(state, dict) else {}
    if not isinstance(atoms, dict):
        result["reason"] = "Unrecognized persisted-state schema"
        return result
    selections = atoms.get("last-observed-cloud-pet-selection-v1", {})
    migrations = atoms.get("migrated-cloud-pet-ids-v1", {})
    if not isinstance(selections, dict) or not isinstance(migrations, dict):
        result["reason"] = "Unrecognized migration/selection schema"
        return result
    active = {value for value in selections.values() if isinstance(value, str) and value}
    cloud = set()
    for mapping in migrations.values():
        if not isinstance(mapping, dict):
            continue
        if mapping:
            result["migration_observed"] = True
        for key in ("custom:" + pet_id, pet_id):
            value = mapping.get(key)
            if isinstance(value, str) and value:
                cloud.add(value)
    result.update(status="observed", cloud_pet_ids=sorted(cloud), active_cloud_pet_ids=sorted(active),
                  requested_pet_migrated=bool(cloud), route="cloud" if cloud else "local-files")
    result["current_cloud_matches"] = sorted(active & cloud)
    result["reason"] = ("Resolve the mapped stable cloud ID with the Pets plugin; local writes will not update it."
                        if cloud else "No mapping found for this folder. This does not prove the live pet is local or migration is disabled.")
    return result


def require_local_target(observation, local_files_only=False):
    if observation.get("requested_pet_migrated") and local_files_only is not True:
        targets = ", ".join(observation["cloud_pet_ids"])
        raise ValueError(f"Pet was migrated to cloud ID(s) {targets}; resolve/update the existing account pet with the Pets plugin. "
                         "Use --local-files-only only for an explicitly requested local-file edit.")


def require_intrinsic_runtime(runtime, pet_id, source_hash, observation):
    valid = (runtime.get("pet_id") == pet_id and runtime.get("source_sha256") == source_hash
             and runtime.get("target_kind") == "local"
             and runtime.get("image_transport") == "direct-local"
             and runtime.get("automatic_cloud_migration") is False
             and runtime.get("image_normalization") is False
             and runtime.get("animated_bytes_preserved") is True
             and runtime.get("renderer") == "css-background"
             and runtime.get("native_timing_verified") is True
             and all(runtime.get(key) is False for key in
                     ("reduced_motion_required", "pause_required", "state_entry_sync_required"))
             and runtime.get("resource_review") == "pass"
             and isinstance(runtime.get("client_version"), str) and bool(runtime["client_version"].strip())
             and isinstance(runtime.get("evidence"), str) and len(runtime["evidence"]) >= 20)
    if not valid:
        raise ValueError("Intrinsic animation requires verified direct-local transport, preserved animated bytes, "
                         "disabled cloud migration/normalization, and hash-bound runtime/accessibility/resource evidence; unknown is not false")
    if observation.get("migration_observed") or observation.get("requested_pet_migrated"):
        raise ValueError("Client migration evidence blocks intrinsic WebP; use a static atlas and the correct local/cloud workflow")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pet-id", required=True)
    parser.add_argument("--codex-home")
    parser.add_argument("--output")
    args = parser.parse_args()
    result = inspect_target(args.codex_home, args.pet_id)
    if args.output:
        output = Path(args.output)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
