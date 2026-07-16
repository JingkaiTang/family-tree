# Open-source alpha hardening plan

## Goal

Bring the desktop family-tree application to a public alpha baseline without changing its product scope or publishing external artifacts.

## Success criteria

- Saving is revision-aware, serialized, and drained before closing a project.
- Photo changes are staged until the member edit is committed; cancel never breaks an existing photo reference.
- Tauri commands reject path traversal and invalid media IDs, use a restrictive CSP, and expose only required permissions.
- The project format has one current schema version and validates graph-level invariants at load/save boundaries.
- Browser builds run expensive layout work in a native Web Worker while tests and unsupported environments use the deterministic synchronous core.
- `FamilyCanvas` delegates layout lifecycle and drag calculations to focused modules instead of owning every concern.
- A clean clone has licensing, contribution, security, architecture, file-format, CI, formatting, and verification guidance suitable for external contributors.

## Steps and commit boundaries

1. **Plan and baseline**
   - Record this plan and confirm the existing test/build baseline.
   - Commit: `docs: plan open-source alpha hardening`

2. **Revision-safe saving**
   - Add a monotonic data revision to the family store.
   - Replace boolean-triggered autosave with a serialized coordinator that snapshots project, data, and revision.
   - Drain or report save failures before closing a project.
   - Add race, debounce, close, and failure tests.
   - Commit: `fix: make project saving revision-safe`

3. **Transactional photo editing**
   - Stage imported media while a member draft is open.
   - Commit the member reference before retiring the old photo.
   - Remove staged media on cancel and preserve recoverable media on failure.
   - Add component/service regressions for replace, remove, cancel, and failed save.
   - Commit: `fix: make photo edits transactional`

4. **Desktop security boundary**
   - Validate project directories and UUID media IDs in Rust.
   - Canonicalize and enforce descendant paths before file operations.
   - Restrict CSP and asset protocol access; remove unused filesystem plugin permissions.
   - Add Rust traversal and invalid-project tests.
   - Commit: `fix: harden desktop filesystem boundaries`

5. **Project format integrity**
   - Align metadata and family schema versions.
   - Add graph-level validation for IDs, references, reverse edges, duplicates, spouse uniqueness, and ancestry cycles.
   - Enforce validation after migration and before save.
   - Add corrupted-project fixtures and migration coverage.
   - Commit: `fix: validate family project integrity`

6. **Layout execution boundary**
   - Extract the deterministic synchronous layout core.
   - Use a native browser Worker with request correlation and deterministic fallback.
   - Keep the public facade and existing layout contracts stable.
   - Commit: `perf: run family layout in a web worker`

7. **Canvas responsibility split**
   - Extract layout lifecycle/focus and drag-order helpers from `FamilyCanvas`.
   - Preserve public props, events, behavior, and component regressions.
   - Commit: `refactor: split family canvas responsibilities`

8. **Open-source project surface**
   - Add MIT license text, contribution/security/conduct files, issue/PR templates, architecture and project-format documentation.
   - Remove unused dependencies and align formatting.
   - Extend CI with Rust format, Clippy, tests, frontend verification, and performance checks.
   - Run the complete verification suite and document release prerequisites that require maintainer secrets.
   - Commit: `chore: prepare repository for open-source alpha`

## Out of scope

- Publishing the repository or binaries.
- Creating or storing signing keys and release secrets.
- Declaring the file format stable beyond the `0.x` compatibility policy.
- Rewriting the tested kinship or family-layout algorithms.
