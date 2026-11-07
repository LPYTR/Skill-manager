---
name: codex-photo-pet
description: Create, edit, validate, install, or adjust the playback of full-body Codex desktop pets from reference photos or character art. Use for local Codex pets and their previews; route ChatGPT Work account pets to the Pets plugin instead.
---

# Codex Photo Pet

Produce a consistent full-body desktop pet, inspectable animation and a verified local installation. Preserve the requested likeness, style, outfit, destination and activation choice. Also handle appearance changes and speed feedback on an existing local pet.

## Resolve the target

- Distinguish **Codex local files**, **ChatGPT Work account pets**, and **Petdex Desktop**. A local folder is not identified by a ChatGPT Work pet ID. Do not create an unrelated cloud pet to repair a local one.
- For existing/current-pet feedback, read [target resolution](references/target-resolution.md) first. A formerly local pet may have been automatically migrated to an account pet. Inspect current selection, migration evidence and the actual served artwork; the presence of `pet.json` alone does not identify the playback target. Update the mapped existing cloud ID through the Pets plugin when applicable.
- Reuse the established destination. Otherwise resolve `CODEX_HOME`, falling back to the user's `.codex` directory. Source artifacts and storage may live on another drive; use a directory link when authorized. Never hardcode an administrator profile, drive, app build or the previous example person's identity.
- For an existing pet, read `pet.json`, resolve its actual image, inspect the encoded bytes, and preserve its stable folder/ID. Do not infer support for custom timing fields.
- Determine the target's supported sprite version. Local v1 is valid when nine animations satisfy the request. Add v2 gaze directions when requested or materially useful and supported. Do not force a cloud-only v2 workflow onto a local v1 task.
- For a still/concept-only request, stop at that artifact. Installation and activation are different outcomes; activate only when requested.

## Prepare a bounded run

Create one run directory outside the skill package. Save the brief, selected references, approved style/outfit, source strips, frames, QA, previews, release manifest and installation record there. Personal photos and generated characters do not belong in this reusable skill.

Read [format and tools](references/format-and-tools.md). Python helpers require Python 3.10+ and Pillow; MP4/animated WebP additionally need `imageio-ffmpeg`. The browser probe uses Node 22+ and a local Chromium browser. Resolve interpreters once. Diagnose an inaccessible cache instead of repeatedly trying the same command; use the host's permission mechanism when necessary.

Use image generation for new or edited **artwork**, following the available image tool/skill. Deterministic extraction, shared registration, encoding, timing and previews may use these helpers; they must not draw replacement character art. If generation is unavailable, retain the inputs and report that blocker.

Start with the base and an idle/directional row. Limit a source job to two attempts with the same strategy; after repeated failure change the pose, geometry or references once. If it still fails, preserve passing artifacts, identify the blocked gate, and stop that release. Do not run an unbounded full-pet regeneration. Keep progress updates brief and show real motion early.

## Generate and extract

Read [artwork and visual review](references/generation-and-review.md) for prompts, gait, extraction and gaze.

1. Establish one full-body base with complete head and shoes/paws. For photographs preserve likeness and the requested real/stylized proportions. A generated still is a **base preview**, not a completed animated pet.
2. Ground every row in that base and defining references. Respect the tool's actual reference limit; use a pixel-preserving reference montage when needed. Explain each reference's role and exclude screenshot UI from final art.
3. Generate separate state strips, never the entire final atlas. Require separated complete silhouettes, safe gaps/outer margins, contrasting flat chroma or true alpha, and no guide marks or detached effects.
4. Extract complete connected pose groups in order. Preserve a shared row scale and intentional jump displacement. Do not assume equal source slots or independently fill every frame to its bounds. Inspect extracted rows immediately.
5. Assemble the declared version and validate the exact encoded release. Correct dimensions alone do not prove likeness, motion or semantics.

Four genuinely generated contact/passing phases repeated twice may fill an eight-frame gait if limbs visibly alternate. Record that derivation; do not call it eight unique phases. For a gentler cadence, reviewed phases may instead occupy consecutive holding cells. An entire motion row must never become identical copies. Do not mirror an asymmetric identity without checking it.

For v2, approve up/right/down/left anchors before coherent gaze rows. Keep the torso/base planted, move head/eyes naturally and retain facial landmarks. Repair ambiguous cardinals before continuing; repair a failed final gaze row coherently rather than pasting an unrelated cell.

## Release gates

For new artwork or visual replacements:

- `pet_assets.py validate` must pass the supported dimensions, occupied/unused cells, alpha, safe edges, format, size and visible-pose variation for the **actual image hash**. Every standard animation needs at least two visibly different poses; intentional holding cells are allowed. This automatic check does not certify gait or visual semantics.
- Record visual review of likeness, clothes, proportions, attachments, full-body visibility and every state's meaning. Directional movement needs visible cadence. `running` means working, not foot-running. Jumping must actually lift and return to its ground line. Clipping, seams, chroma contamination, disappearing faces, size pops and wrong directions block release.
- Render motion **from the encoded atlas**: per-state/all-state GIFs, four labeled stills, idle→jump→idle, and MP4 when the encoder exists. For v2 also inspect a labeled gaze sheet and ordered loop. One still is not proof of motion.
- Show motion before installing a visual replacement. Apply feedback to affected sources, re-encode and rerun affected checks. Existing authorization to create/install suffices; do not invent an extra confirmation requirement.
- Distinguish automatic checks from recorded visual judgment. Never fabricate a passing report or install known-broken art. Minor intermediate gaze subtlety can be a documented warning; wrong cardinals/quadrants, reversals, detached parts and obvious pops are failures.

`pet_assets.py release` binds the structural report, concrete visual review and previews to the image hash; missing/failed evidence blocks it. Revalidate after image bytes change. Preview-only timing changes do not require regenerating artwork. See the reference for the review schema.

## Speed feedback

Resolve whether the user means the GIF, preview page, desktop pet or both; continue independent preview work while useful clarification is pending. Read [playback](references/playback.md) before touching native timing.

- Change preview durations with `--speed 0.65` for a moderate first slowdown unless specified otherwise. A speed selector can help the user tune it.
- To compare with desktop behavior, use `--timing-profile native --idle-multiplier VALUE` from the inspected client. Keep this distinct from an independently slowed preview. The viewer then plays an action three times before idle; per-state GIFs loop a single cycle for inspection.
- A slower preview does **not** change native playback. Check the current app's actual settings/metadata first. Do not invent `speed`, `fps` or duration keys in `pet.json`.
- Without a supported rate control, prefer a reviewed static frame map using `pet_assets.py retime`: longer pose holds and fewer repeated gait cycles can make motion calmer. Record actual hold durations and pose-change counts; this does not change the native loop period or implement a global playback-rate multiplier. Review alternating limbs and wrap continuity again.
- Intrinsic animated WebP is an **experimental direct-local technique**, not a fallback for account pets. Require hash-bound evidence that automatic cloud migration and image normalization are disabled and the exact animated bytes reach the renderer. Unknown is not false. The build/release/install helpers block observed migration. A headless browser test alone does not establish that transport. Preserve accessibility, state-entry and resource requirements; do not patch the installed app.
- Preserve the static master and prior active configuration/image. Report which surface changed, what was measured and whether the app needs to reload.

## Install and finish

Read [installation and rollback](references/local-install.md). Run `install_pet.py plan` for concrete paths/conflicts, then `apply` within authorization. Both stages inspect migration evidence; a mapped account pet blocks accidental local repair. Use `--local-files-only` only when the user explicitly wants local source files edited despite the migration. The helper validates the release again, preserves existing content, writes metadata atomically and verifies the image through the path Codex reads. Do not modify unrelated pets or global app files.

For account pets/Petdex Desktop use their supported workflows. Finish independent artifacts if a required service is unavailable; identify the remaining blocker.

For **this agent skill's** own deployment/update, follow the user's Skill Manager policy, verify with `show`, and report Manager ID and active path. Pet assets and ordinary Python/Node dependencies are not agent skills.

Report the name, actual local/cloud target, installed/artifact path, usable motion preview, validation outcome and material limits. For account changes, read back the same ID and inspect freshly downloaded stored bytes; normalization may change the file hash, so compare visible cells and pose coverage too. Keep file/service verification, client-cache readback and observed live motion as separate evidence. State any reselect/reload step; do not silently restart the user's session.
