# Identify the artwork actually being played

Use this for existing-pet repairs, speed feedback and reports that a local change
had no effect. A pet can retain a local folder after the client migrates it to
an account record. Do not assume the folder still supplies the desktop artwork.

1. Identify the requested logical pet and intended surface. For an account pet,
   resolve its stable custom ID and active state with the available Pets plugin.
   Names alone are not unique. Preserve the ID; do not create a new pet to repair
   an existing migrated one, or change selection without authorization.
2. Inspect local metadata and directory links when relevant. The read-only helper
   below reports known client migration mappings and cached account selection:

   ```text
   python scripts/target_state.py --pet-id SLUG --codex-home HOME --output RUN/qa/target.json
   ```

   It reads only relevant keys from `HOME/.codex-global-state.json`; these are
   observed client internals, not a stable API. It prints no account credentials
   or unrelated conversation state. Missing/malformed state or no mapping is
   **not proof** that live playback is local or migration is disabled. Use
   supported service/UI evidence to resolve uncertainty before changing the
   current pet. Multiple mapped account IDs require scope resolution.
3. If the requested folder maps to an account ID, update that existing account
   pet using its plugin workflow. Fetch its current stored artwork before
   inspecting or repairing it. Restore approved static rows when an animated
   atlas was flattened during normalization; do not retry an intrinsic clock
   through the same normalizing path.
4. The local install planner and apply stage both recheck migration evidence.
   `--local-files-only` is an exception for an explicitly requested local-file
   edit, not a way to make a cloud repair appear successful. It cannot authorize
   an intrinsic-clock release in a migrating client.
5. Verify the changed resource after persistence. For account artwork, download
   the newly stored sheet and compare required cells, pose variation and alpha
   against the approved source. PNG re-encoding can change file hashes while
   preserving visible pixels; ignore hidden RGB under zero alpha and tolerate
   only documented codec rounding. Verify the same stable ID and prior active
   selection, then read the client's new artwork reference if available.

Record separately: local file installation, account update, client resource
refresh, and visually observed live motion. A headless test or changed cache
reference does not prove that the visible desktop animation played.
