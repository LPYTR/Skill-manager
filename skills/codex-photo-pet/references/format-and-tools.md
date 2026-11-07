# Format and tools

Cells are 192×208, eight columns. v1 is 1536×1872 (9 rows); v2 is 1536×2288 (11 rows). Transparent PNG/WebP, at most 20 MiB. Unused cells must be completely transparent. Verify future-client compatibility rather than treating these observations as a permanent API.

|Row|State|Frames|Base durations (ms)|
|---:|---|---:|---|
|0|idle|6|280,110,110,140,140,320|
|1|running-right|8|120×7,220|
|2|running-left|8|120×7,220|
|3|waving|4|140×3,280|
|4|jumping|5|140×4,280|
|5|failed|8|140×7,240|
|6|waiting|6|150×5,260|
|7|running (working)|6|120×5,220|
|8|review|6|150×5,280|
|9|look A, v2|8|000,022.5,045,067.5,090,112.5,135,157.5°|
|10|look B, v2|8|180,202.5,225,247.5,270,292.5,315,337.5°|

Gaze is clockwise in viewer coordinates: up=000, right=090, down=180, left=270. Neutral uses idle, not a seventeenth look cell.

## Commands

Resolve this skill's directory; use a separate absolute run directory. Helpers expose `--help` and do not download sources or execute imported/generated packages.

```text
python scripts/pet_assets.py init --run RUN --name NAME --pet-id SLUG --version 1
python scripts/pet_assets.py extract --run RUN --state idle --strip SOURCE.png --key '#FF00FF'
python scripts/pet_assets.py assemble --run RUN
python scripts/pet_assets.py validate IMAGE --report REPORT.json
python scripts/pet_assets.py previews IMAGE --output PREVIEWS --speed 0.65
python scripts/pet_assets.py previews IMAGE --output NATIVE_PREVIEWS --speed 1 --timing-profile native --idle-multiplier VERIFIED_VALUE
python scripts/pet_assets.py retime IMAGE --frame-map MAP.json --output NEW.png --report CADENCE.json --timing-profile native --idle-multiplier VERIFIED_VALUE
python scripts/pet_assets.py release --run RUN --image IMAGE --review REVIEW.json --previews PREVIEWS
python scripts/target_state.py --pet-id SLUG --codex-home CODEX_HOME --output RUN/qa/target.json
python scripts/install_pet.py plan --release RELEASE.json --codex-home CODEX_HOME --storage PET_STORAGE
python scripts/install_pet.py apply --plan PLAN.json
python scripts/install_pet.py rollback --record INSTALLATION.json
```

Dependencies: Pillow; optionally `imageio-ffmpeg`. An existing environment is preferred; `uv run --with pillow --with imageio-ffmpeg python ...` is one option. Do not replace HOME/PATH just to resolve an interpreter.

`extract` removes optional chroma, finds dominant connected pose groups, groups small nearby fragments and requires the planned count. No fallback to equal-slot slicing. It applies one shared scale/ground transform, preserving vertical displacement. The first pose is the standing-size reference unless `--reference-index` identifies another planted pose. `--source-count 4 --repeat 2` supports a verified four-phase directional gait. Already extracted/repaired 192×208 transparent frames may be placed in `frames/STATE/00.png`, etc.; do not splice unrelated cells into coherent gaze rows.

`assemble` copies frame pixels into exact cells and clears hidden RGB for the static master. `validate` checks encoded bytes, format, alpha, dimensions, occupied/unused cells, edges and obvious chroma contamination. It also reports each standard row's distinct visible poses, groups and cyclic pose changes, and rejects rows with fewer than two visible poses. Repeated holding cells and repeated gait cycles remain valid. Comparison uses alpha and two compositing backgrounds with two-level rounding tolerance; hidden RGB noise is not motion. It rejects animated masters by default; a temporal-clock release needs separate verification.

`retime` accepts `{"states":{"STATE":[SOURCE_COLUMN,...]}}`, preserving the
required cell count and all unmapped/gaze cells. It records source/output hashes,
the actual map, pose holds and change ratios. It refuses an all-identical row and
requires new preview/review/release evidence for its new image. Loop periods and
native playback rate are unchanged. See [playback](playback.md) before selecting
phases; a low transition count alone does not prove a correct gait.

## Review schema

After inspecting the actual encoded contact sheet and movement, save:

```json
{
  "image_sha256": "hash of the inspected encoded image",
  "overall": "pass",
  "motion_seen": true,
  "states": {"idle": {"verdict": "pass", "evidence": "Observed blink/breath; planted feet."}},
  "directions": {"000": {"verdict": "pass", "observed": "up", "evidence": "Observed raised chin and upward face."}},
  "limitations": []
}
```

Include **all nine state names**, not just the example. Use `pass`, `warning`, `fail`; warnings need evidence and an accepted limitation. For v2 include all sixteen labels/observed directions; cardinals must pass without ambiguity. The release helper verifies the presence and hash binding of non-failing evidence; it cannot certify natural gait or a person's likeness. Reuse a review only while its image hash is unchanged.

Preview export records a SHA-256 for every required GIF/image/viewer file and any generated MP4. Release decodes GIF/image outputs and checks their hashes; video presence is required when export recorded it as generated. The preview manifest itself is bound into the release and is checked again during installation. Rerendering a preview means refreshing the release before another install; do not reuse stale proof after files are removed, replaced or corrupted.
