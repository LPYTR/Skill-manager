---
name: skill-manager
description: Required workflow on this computer for every agent-skill installation or update, even when the user does not mention Manager. Register and verify skills through Skill Manager; also use for inventory, installation locations, and uninstalling managed copies.
---

# Skill Manager

Use the local CLI below. It works from any working directory and does not need the web UI:

```powershell
{{COMMAND}} list --json
```

Run commands with `--json`. Read `ok`, `data`, and `error`; do not infer success from downloaded files alone. If `PARTIAL_FAILURE` occurs, the package was saved but one or more installations failed; report both stages and the paths returned.

Every authorized skill installation or update must be recorded in Manager. Do not use a separate installer or direct copying as the final step. If Manager is unavailable, stop dependent work. An item-specific conflict stops that item; independent items may continue through Manager after reporting the failure. Before claiming completion, run `show SKILL_ID --json` and verify the saved source/revision and the actual active installation path. Include the Manager ID and installed path in the result.

If an unavoidable third-party installer already deployed a standalone skill, register the actual package using `add ABSOLUTE_INSTALLED_SKILL_DIRECTORY --no-install --json`, then `scan --root ABSOLUTE_INSTALLED_SKILL_DIRECTORY --json`, and verify its path is represented. Keep system/plugin bundles read-only and inventory them with `scan`. Register new project or custom targets so subsequent automatic inventory reads can find installations there.

## Add and install

Find a source appropriate to the user's request, then pass the repository URL or already-downloaded folder/ZIP to `add`:

```powershell
{{COMMAND}} add https://github.com/OWNER/REPO --subdir skills/NAME --json
{{COMMAND}} add 'D:\Downloads\some-skill' --json
```

`add` saves a complete package to Manager and **defaults to installing it in the Codex user target**. Use `--no-install` when the user asks only to collect it. For another tool or project, use `targets list --json` and `--target ID`. Register a project with `targets add NAME --tool codex --project ABSOLUTE_PATH --json` (or `--tool claude`), or a custom target with `--path ABSOLUTE_PATH`.

Use the repository root URL; specify a branch/tag/commit with `--ref` and a package path with `--subdir`. When `SELECTION_REQUIRED` returns candidates, choose the requested package. Use `--all` only when the user's request includes every package. If a source isn't a public GitHub repository, download it through an available tool and add its local directory or ZIP.

Batch discovery excludes test/fixture directories and selects one target-compatible distribution of a same-named skill. Read `data.skipped`; those entries are not failed installations. Never add `--include-fixtures` merely to make a batch succeed. If the user explicitly wants a different distribution, select its exact `--subdir` and resolve any existing installation through Manager first.

Application add-ons (for example Blender extensions) are not agent skills. Use the application's official installer; do not generate a fake skill wrapper just to obtain an `active` catalog entry.

## Inventory and other operations

- `scan --json`: index known tool and registered project directories. Add `--root ABSOLUTE_PATH` for an additional collection or `--project ABSOLUTE_PATH` for both tools' project presets. Existing files stay in place.
- `list --query TEXT --json` and `show SKILL_ID --json`: automatically scan registered locations, then search and inspect. Use IDs from these results, not names, which may repeat.
- `install SKILL_ID --target TARGET_ID --json`: deploy an existing package; optional `--revision REVISION_ID` selects an available version.
- `uninstall INSTALLATION_ID --json`: remove one owned installation, retaining the original package and backup. Never remove directories manually to bypass ownership or modification checks.
- `doctor --json`: diagnose missing sources, modified copies, and interrupted operations.
- `relink SKILL_ID ABSOLUTE_PATH --json`: reconnect a moved external source.
- `archive SKILL_ID --reason TEXT --json`: hide an uninstalled fixture or alternate distribution while retaining all files, versions and personal notes. `unarchive SKILL_ID --json` restores the record. Archiving refuses active installations; uninstall only the specific owned copy first.
- `edit SKILL_ID --tags 'tag1,tag2' --notes TEXT --json`: update personal metadata.
- `backup --out FILE --json`: metadata only. `export SKILL_ID --out FILE.zip --json`: complete package; missing originals cannot be exported.
- `ui`: open the local webpage only when requested.

For `CONFLICT`, `LOCAL_MODIFICATIONS`, or `RECOVERY_REQUIRED`, explain the returned reason and preserve the files. Do not invent a force flag. `--dry-run` previews changes; remote add previews do not download or validate repository contents. System and plugin content is inventory-only, and cached plugins are not proof that a tool enabled them.

The skill authorizes no unrelated downloads, installation, or file removal. Act within the current user's request. Never execute scripts inside an imported package as part of installation.
