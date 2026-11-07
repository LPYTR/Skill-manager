# Preview and desktop timing

A speed of 0.65 means durations are **divided** by 0.65. Ask which surface is fast when needed: GIF, preview page, native desktop, or both. Change timing without regenerating the person. `pet_assets.py previews IMAGE --output DIR --speed 0.65` exports matching GIF/video timing and a speed-selectable viewer. Verify encoded durations; do not leave MP4 at the old cadence.

For an existing/current pet, complete [target resolution](target-resolution.md)
first. A change to a retained local folder will not change a migrated account pet.

## Current-client evidence

One inspected Windows build, **Codex 26.1027.3384.0**, accepted local `id`, `displayName`, `description`, `spriteVersionNumber` (1/2), `spritesheetPath`. Its React renderer used CSS backgrounds with fixed duration arrays from the format reference. Idle durations were multiplied by six; non-idle effects normally played three cycles then idle. Reduced motion selected a static frame. These are dated observations, not a public stable API.

Prefer supported settings when present. Do not invent metadata speed fields. Inspect only relevant local resources if necessary; keep extracted proprietary code outside this skill and release packages. Do not patch installed bundles, inject global timers, bypass integrity checks or silently restart the user's app.

## Native timing preview

The default `base` profile is a row-artwork preview, not a desktop simulation.
For the observed build, base idle is 1100ms and native idle is 6600ms. Supply the
verified multiplier explicitly rather than treating six as a permanent default:

```text
python scripts/pet_assets.py previews STATIC --output NATIVE_PREVIEWS --speed 1 --timing-profile native --idle-multiplier 6
```

The native viewer returns to idle after three action cycles. GIFs loop individual
state cycles so each row remains inspectable; their idle duration, viewer idle
duration and MP4 timing use the same profile. A preview speed selector changes
only that preview. Report the timing profile and client evidence.

## Static cadence adjustment

When no supported native rate control exists, retain a static atlas and review
an explicit frame map. For a verified four-phase gait repeated twice, changing
`[0,1,2,3,0,1,2,3]` into `[0,0,1,1,2,2,3,3]` halves pose changes per native cycle.
Do not blindly discard half of an eight-phase single-cycle gait: confirm that
both contacts, passing phases, alternating limbs and natural wrap remain.
Standing gestures may use longer holds of smaller existing pose variations.

Write a frame map such as:

```json
{"states":{"running-right":[0,0,1,1,2,2,3,3]}}
```

```text
python scripts/pet_assets.py retime STATIC --frame-map MAP.json --output CALM.png --report CADENCE.json --timing-profile native --idle-multiplier 6
```

The helper preserves unmapped rows and v2 gaze pixels, refuses a frozen motion
row, preserves the source, and records pose holds and transition ratios. The
native loop period stays fixed: this is **not** a global 0.5/0.65 playback-rate
setting. Longer holds may look more stepped. Render the exact new atlas with
native timing, review gait/gesture semantics and continuity, and obtain a new
hash-bound release before using the applicable local/account workflow.

## Experimental direct-local animated WebP

Do not use this path for account pets or a client that may automatically migrate
or normalize them. An upload accepting WebP does not imply that animation is
preserved: flattening this special atlas leaves one pose repeated across every
used column, so native column changes produce no motion. Prefer static cadence
adjustment unless direct-local transport and complete animation preservation
have actually been established.

For a verified direct-local CSS-background client with fixed column delays:

1. Preserve the static master.
2. At each temporal point repeat a standard row's **current** source pose into every used column. Native column changes then select the same pose; WebP's own timeline controls movement. Unused cells remain transparent.
3. For v2 retain the sixteen distinct gaze cells unchanged across time; do not repeat a gaze pose across its row.
4. Fit integer row-cycle counts into a shared temporal period. Account for native idle multiplication, record effective speeds and retain natural wrap. Approximations must be reported as such.
5. Decode and inspect every temporal frame: shape, alpha, occupied/unused cells, equivalent visible standard columns, original gaze cells, pose coverage, duration and size. Ignore invisible RGB under zero alpha; compare exact alpha and composited visible RGB.
6. Test actual Chromium CSS playback with the current native column durations. Capture screenshots over several cycles, recognize them against original poses and measure the gesture period. `is_animated` alone is insufficient.
7. Recheck target/migration evidence, then install that exact measured file under a new name with an atomic path update. Keep prior config/static image and state whether Codex still needs to reload.

`desktop_clock.py` and `verify_browser.mjs` implement this without new character art or app modifications. The probe uses a fresh hidden profile and closes only its own process. Establish that its rendering path represents the current client before treating it as native evidence.

### Blocking conditions

- Unknown/non-CSS rendering, unsupported animated WebP, failed decode or failed measured playback.
- Account target, automatic migration, normalization/flattening, unverified preservation of animated bytes, or a runtime report for a different pet/source. Observed migration blocks build/release/install even if a runtime JSON claims it is disabled.
- Required reduced-motion, pause, exact state-entry synchronization or seeking that an independent animated background cannot honor. The image clock continues if the app merely chooses one static column. **Never bypass a reduced-motion preference.** Retain the static pet or use a supported control when these requirements apply.
- Output over 20 MiB, unacceptable memory/CPU, tearing/pops, lost temporal poses or altered gaze cells. Compressed size does not bound decoded memory; check resource use when material.

Explain these tradeoffs when selecting the optional route. A browser simulation is compatibility evidence, not proof the live Codex window refreshed. Do not upload the animated atlas to a cloud service unless that service explicitly supports its format/semantics.

```text
python scripts/desktop_clock.py build --image STATIC --output SLOW.webp --report ENCODING.json --runtime RUNTIME.json --speed 0.65 --idle-multiplier 6
node scripts/verify_browser.mjs --sheet SLOW.webp --output BROWSER_QA --browser CHROMIUM_EXE
python scripts/desktop_clock.py verify --image SLOW.webp --source STATIC --encoding ENCODING.json --browser-qa BROWSER_QA --report TEMPORAL_QA.json
python scripts/desktop_clock.py release --static-release STATIC_RELEASE.json --image SLOW.webp --validation TEMPORAL_QA.json --runtime RUNTIME.json --output PLAYBACK_RELEASE.json
```

The probe defaults to the observed four-frame waving cadence. Pass actual four durations with `--durations` when the runtime differs. Defaults must not be described as current without checking.

For v2 pass `--rows 11` to the browser probe. `RUNTIME.json` must bind `pet_id`,
`source_sha256`, and `client_version`; record `target_kind: "local"`,
`image_transport: "direct-local"`, `automatic_cloud_migration: false`,
`image_normalization: false`, and `animated_bytes_preserved: true` only after
observing the complete transport. Also record the actual `renderer`
(`css-background`), `native_timing_verified: true`, `reduced_motion_required`,
`pause_required`, `state_entry_sync_required`, `resource_review` (`pass` only
after checking), and concrete `evidence`. Supply `codex_home` when it differs
from the resolved default. All five disqualifying flags must be explicitly
false; unknown is not false. These reports bind observations and hashes without
certifying judgments the agent did not actually make.
