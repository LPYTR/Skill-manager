# Local installation and rollback

These helpers install **pet assets**, not agent skills. Deploy this skill itself through Skill Manager under the user's policy; do not register pet images as skills.

Resolve `CODEX_HOME` or the user's `.codex`; local pets live in `pets/ID`. Preserve an existing folder/ID. A local slug is not a ChatGPT Work account ID.

For an existing/current-pet change, follow [target resolution](target-resolution.md).
Both `plan` and `apply` inspect current migration mappings, so a pet migrated
between planning and application is caught before its metadata changes. A mapped
account ID blocks accidental local repair. Use `--local-files-only` only when
editing the retained local source is explicitly requested; record that the
account artwork was not changed. Missing migration evidence is not proof the
live pet is local. The plan and installation record include target evidence.

Default storage is the same local directory. For another drive pass a separate pet-storage root: a new directory junction/symlink connects the client path to physical storage. Do not move other pets or the entire Codex home. Verify both paths.

`install_pet.py plan` reads a hash-bound release and writes `install-plan.json`, checking absolute paths, identity, conflicts, source evidence and the exact operations. It does not modify a live pet. `apply` rechecks source/review hashes, copies a hash-named image, preserves metadata on updates, atomically replaces `pet.json`, and verifies the result through Codex's actual path. On verification failure restore previous metadata and retain diagnostics. Never delete an old image as implicit cleanup.

Supported baseline metadata:

```json
{"id":"example-pet","displayName":"Example Pet","description":"A concise description.","spriteVersionNumber":1,"spritesheetPath":"spritesheet-HASH.webp"}
```

Do not alter active selection. Creating, installing, activating and seeing the app refresh are separate claims. Report the reload/reselect step when necessary.

## Timing-only update

Preview-only timing changes must not modify native metadata. Static cadence
changes require a new image hash, native-timing previews and visual release.
An experimental playback release separately binds the animated image hash,
original static hash, exact local identity, direct-local transport evidence,
full temporal validation, measured browser QA and accepted accessibility/resource
conditions. Migration or normalization blocks it, including when local-file-only
editing is authorized. A headless probe alone is not transport evidence.

## Rollback

`install_pet.py rollback --record INSTALLATION.json` verifies the current manifest still matches the recorded installation. If another process/user changed it, stop rather than overwrite. For an update restore the saved prior manifest. For a newly created pet remove only the recorded metadata, leaving image/directory/link for inspection. Do not recursively delete targets.

Verify and record the rollback result. A Manager failure blocks that skill deployment item; a pet release/runtime failure blocks that pet. Never claim either succeeded without its required evidence.
