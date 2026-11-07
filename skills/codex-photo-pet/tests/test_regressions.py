"""Behavioral regressions; synthetic fixtures never touch live pets or accounts."""
from __future__ import annotations

from argparse import Namespace
import json
import os
from pathlib import Path
import re
import shutil
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from PIL import Image, ImageDraw
import pet_assets as assets
import install_pet
from target_state import inspect_target, require_local_target, require_intrinsic_runtime


def fixture_atlas(path, frozen=(), hidden_noise=False):
    """Test geometry, not generated or releasable character artwork."""
    atlas = Image.new("RGBA", (1536, 1872))
    for row, (state, count, _) in enumerate(assets.SPECS):
        for col in range(count):
            phase = 0 if state in frozen else col % 4
            bottom = [200, 196, 176, 196, 200][col] if state == "jumping" else 200
            cell = Image.new("RGBA", (192, 208), (col * 20, row * 20, 90, 0) if hidden_noise else (0, 0, 0, 0))
            draw = ImageDraw.Draw(cell)
            x = 65 + phase * 10
            draw.rectangle((x, bottom - 140, x + 30, bottom - 1), fill=(170, 190, 210, 255))
            atlas.paste(cell, (col * 192, row * 208))
    atlas.save(path)


class RegressionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.scratch = (Path(os.environ.get("PET_TEST_SCRATCH", tempfile.gettempdir())) / "codex-photo-pet-regression").resolve()
        cls.scratch.mkdir(parents=True, exist_ok=True)
        cls.temporary = tempfile.TemporaryDirectory(prefix="case-", dir=cls.scratch)
        cls.root = Path(cls.temporary.name).resolve()
        assert cls.root.parent == cls.scratch
        cls.source = cls.root / "source.png"
        fixture_atlas(cls.source)
        cls.source_hash = assets.digest(cls.source)

    @classmethod
    def tearDownClass(cls):
        # Check the exact generated absolute target before recursive test cleanup.
        assert Path(cls.temporary.name).resolve().parent == cls.scratch
        cls.temporary.cleanup()

    def setUp(self):
        self.work = self.root / self._testMethodName
        self.work.mkdir()

    def preview(self, name, profile="base", multiplier=None, speed=1):
        output = self.work / name
        report = assets.previews(Namespace(image=self.source, output=output, speed=speed,
                                          require_mp4=False, timing_profile=profile, idle_multiplier=multiplier))
        return output, report

    def make_release(self):
        output, _ = self.preview("previews")
        brief = {"pet_id": "fixture-pet", "name": "Synthetic test fixture", "description": "Not a real pet",
                 "version": 1, "chroma_key": None}
        assets.write_json(self.work / "brief.json", brief)
        review = {"image_sha256": self.source_hash, "overall": "pass", "motion_seen": True,
                  "states": {state: {"verdict": "pass", "evidence": "Synthetic moving geometry fixture for release schema testing."}
                             for state, _, _ in assets.SPECS}, "limitations": []}
        assets.write_json(self.work / "review.json", review)
        result = assets.release(Namespace(run=self.work, image=self.source, review=self.work / "review.json", previews=output))
        return Path(result["release"])

    def migration(self, home, mapped=True, unrelated=False):
        mappings = {"custom:fixture-pet": "pet_fixture_cloud"} if mapped else {}
        if unrelated:
            mappings["custom:other-pet"] = "pet_other_cloud"
        assets.write_json(home / ".codex-global-state.json", {"electron-persisted-atom-state": {
            "migrated-cloud-pet-ids-v1": {"synthetic-scope": mappings},
            "last-observed-cloud-pet-selection-v1": {"synthetic-scope": "pet_fixture_cloud"}}})

    def runtime(self):
        return {"pet_id": "fixture-pet", "source_sha256": self.source_hash, "client_version": "synthetic-client",
                "target_kind": "local", "image_transport": "direct-local", "automatic_cloud_migration": False,
                "image_normalization": False, "animated_bytes_preserved": True,
                "renderer": "css-background", "native_timing_verified": True,
                "reduced_motion_required": False, "pause_required": False, "state_entry_sync_required": False,
                "resource_review": "pass", "evidence": "Synthetic verified direct-local transport for a unit test only."}

    def test_moving_source_and_documented_repeat_are_valid(self):
        report = assets.validate_image(self.source)
        self.assertTrue(report["ok"], report["errors"])
        row = report["motion_metrics"]["states"]["running-right"]
        self.assertEqual(row["distinct_visible_poses"], 4)
        self.assertEqual(row["pose_changes_per_cycle"], 8)

    def test_frozen_idle_and_drag_rows_fail_even_with_valid_jump(self):
        path = self.work / "frozen.png"
        fixture_atlas(path, frozen=("idle", "running-right", "running-left"))
        report = assets.validate_image(path)
        self.assertFalse(report["ok"])
        self.assertEqual(len([e for e in report["errors"] if "Frozen animation" in e]), 3)
        self.assertGreaterEqual(report["motion_metrics"]["jump_lift_px"], 8)

    def test_hidden_rgb_noise_cannot_disguise_a_frozen_pose(self):
        path = self.work / "hidden-noise.png"
        fixture_atlas(path, frozen=("idle",), hidden_noise=True)
        report = assets.validate_image(path)
        self.assertFalse(report["ok"])
        self.assertEqual(report["motion_metrics"]["states"]["idle"]["distinct_visible_poses"], 1)

    def test_retime_halves_pose_changes_without_changing_loop_or_source(self):
        mapping = self.work / "map.json"
        assets.write_json(mapping, {"states": {"running-right": [0, 0, 1, 1, 2, 2, 3, 3]}})
        output = self.work / "calm.png"
        report = assets.retime(Namespace(image=self.source, output=output, frame_map=mapping,
                                         report=self.work / "cadence.json", timing_profile="native", idle_multiplier=6))
        row = report["rows"]["running-right"]
        self.assertEqual(row["pose_change_ratio"], .5)
        self.assertEqual(row["after"]["pose_holds_ms"], [240, 240, 240, 340])
        self.assertEqual(row["after"]["loop_ms"], row["before"]["loop_ms"])
        self.assertFalse(report["playback_rate_changed"])
        self.assertEqual(assets.digest(self.source), self.source_hash)
        self.assertTrue(assets.validate_image(output)["ok"])

    def test_retime_refuses_an_all_identical_motion_row(self):
        mapping = self.work / "map.json"
        assets.write_json(mapping, {"states": {"running-left": [0] * 8}})
        output = self.work / "bad.png"
        with self.assertRaisesRegex(ValueError, "freeze"):
            assets.retime(Namespace(image=self.source, output=output, frame_map=mapping,
                                    report=self.work / "report.json", timing_profile="base", idle_multiplier=None))
        self.assertFalse(output.exists())

    def test_retime_cannot_reorder_gaze_rows(self):
        mapping = self.work / "map.json"
        assets.write_json(mapping, {"states": {"look-row-9": list(range(8))}})
        with self.assertRaisesRegex(ValueError, "standard state names"):
            assets.retime(Namespace(image=self.source, output=self.work / "bad.png", frame_map=mapping,
                                    report=self.work / "report.json", timing_profile="base", idle_multiplier=None))

    def test_native_preview_matches_idle_and_viewer_profile(self):
        output, report = self.preview("native", "native", 6)
        with Image.open(output / "idle.gif") as image:
            total = 0
            for index in range(image.n_frames):
                image.seek(index)
                total += image.info["duration"]
        self.assertEqual(total, 6600)
        self.assertEqual(sum(report["durations"]["idle"]), 6600)
        profile = json.loads(re.search(r"const profile=(.*?);", (output / "preview.html").read_text(encoding="utf-8")).group(1))
        self.assertEqual(profile["states"][0]["durations"], [1680, 660, 660, 840, 840, 1920])
        self.assertEqual(profile["action_cycles"], 3)
        self.assertFalse(report["native_playback_changed"])
        _, base = self.preview("base")
        self.assertEqual(sum(base["durations"]["idle"]), 1100)

    def test_native_speed_is_not_applied_twice_in_viewer(self):
        output, report = self.preview("slow-native", "native", 6, .65)
        profile = json.loads(re.search(r"const profile=(.*?);", (output / "preview.html").read_text(encoding="utf-8")).group(1))
        self.assertEqual(profile["speed"], .65)
        self.assertEqual(sum(profile["states"][0]["durations"]), 6600)
        self.assertAlmostEqual(sum(report["durations"]["idle"]), 6600 / .65, delta=60)

    def test_native_preview_requires_a_verified_multiplier(self):
        with self.assertRaisesRegex(ValueError, "idle-multiplier"):
            self.preview("unknown", "native")
        self.assertFalse((self.work / "unknown").exists())

    def test_migration_resolves_the_same_logical_cloud_pet(self):
        home = self.work / "home"
        self.migration(home)
        result = inspect_target(home, "fixture-pet")
        self.assertEqual(result["route"], "cloud")
        self.assertEqual(result["cloud_pet_ids"], ["pet_fixture_cloud"])
        with self.assertRaisesRegex(ValueError, "Pets plugin"):
            require_local_target(result)
        require_local_target(result, local_files_only=True)

    def test_local_plan_blocks_a_mapped_pet_before_writing(self):
        release = self.make_release()
        home = self.work / "home"
        self.migration(home)
        with self.assertRaisesRegex(ValueError, "migrated"):
            install_pet.plan(Namespace(release=release, codex_home=home, storage=None, update=False,
                                       output=self.work / "plan.json", local_files_only=False))
        self.assertFalse((home / "pets").exists())
        self.assertFalse((self.work / "plan.json").exists())

    def test_migration_between_plan_and_apply_prevents_the_local_write(self):
        release = self.make_release()
        home = self.work / "home"
        self.migration(home, mapped=False)
        planned = install_pet.plan(Namespace(release=release, codex_home=home, storage=None, update=False,
                                             output=self.work / "plan.json", local_files_only=False))
        self.migration(home, mapped=True)
        before = (home / ".codex-global-state.json").read_bytes()
        with self.assertRaisesRegex(ValueError, "migrated"):
            install_pet.apply(Namespace(plan=planned["plan"]))
        self.assertFalse((home / "pets").exists())
        self.assertEqual((home / ".codex-global-state.json").read_bytes(), before)

    def test_explicit_local_file_work_is_allowed_and_keeps_selection(self):
        release = self.make_release()
        home = self.work / "home"
        self.migration(home)
        before = (home / ".codex-global-state.json").read_bytes()
        planned = install_pet.plan(Namespace(release=release, codex_home=home, storage=None, update=False,
                                             output=self.work / "plan.json", local_files_only=True))
        installed = install_pet.apply(Namespace(plan=planned["plan"]))
        self.assertTrue(installed["local_files_only"])
        self.assertFalse(installed["live_app_refresh_verified"])
        self.assertEqual((home / ".codex-global-state.json").read_bytes(), before)

    def test_intrinsic_clock_rejects_unknown_transport_normalization_and_migration(self):
        home = self.work / "home"
        self.migration(home, mapped=False)
        observation = inspect_target(home, "fixture-pet")
        runtime = self.runtime()
        require_intrinsic_runtime(runtime, "fixture-pet", self.source_hash, observation)
        for key in ("automatic_cloud_migration", "image_normalization", "animated_bytes_preserved", "target_kind", "image_transport"):
            with self.subTest(missing=key):
                incomplete = {k: v for k, v in runtime.items() if k != key}
                with self.assertRaisesRegex(ValueError, "unknown is not false"):
                    require_intrinsic_runtime(incomplete, "fixture-pet", self.source_hash, observation)
        normalized = {**runtime, "image_normalization": True}
        with self.assertRaises(ValueError):
            require_intrinsic_runtime(normalized, "fixture-pet", self.source_hash, observation)
        self.migration(home, mapped=False, unrelated=True)
        with self.assertRaisesRegex(ValueError, "migration evidence"):
            require_intrinsic_runtime(runtime, "fixture-pet", self.source_hash, inspect_target(home, "fixture-pet"))

    def test_intrinsic_runtime_is_bound_to_identity_and_source(self):
        observation = inspect_target(self.work / "missing-home", "fixture-pet")
        for pet_id, image_hash in (("different-pet", self.source_hash), ("fixture-pet", "different-hash")):
            with self.assertRaises(ValueError):
                require_intrinsic_runtime(self.runtime(), pet_id, image_hash, observation)


if __name__ == "__main__":
    unittest.main(verbosity=2)
