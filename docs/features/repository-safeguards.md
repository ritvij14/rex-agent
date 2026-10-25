# Repository safeguards

Status: implemented locally. Remote history replacement and GitHub protection settings are separate approval-gated work. The presence of this file does not mean publication has happened or that remote checks have run.

## Files and responsibilities

| Files | Responsibility |
| --- | --- |
| `scripts/repo-check.ts` | Candidate/index/history snapshots, privacy rules, pinned secret-scan invocation |
| `scripts/check-commit.ts`, `.githooks/` | Identity and commit-message checks; local commit/push gates |
| `scripts/setup.ts`, `scripts/format.ts` | Verified tool installation; formatting only eligible files |
| `tests/*.test.ts` | Synthetic rejection and Git snapshot regression cases |
| `.github/workflows/checks.yml` | Repeat checks with read-only permissions and no repository secrets |

## Candidate working tree

`git ls-files` supplies tracked paths plus untracked, non-ignored paths. Missing tracked files are skipped in this working-tree view only. Private paths are rejected before reading their contents. Allowed roots are explicit; new top-level directories need review. Symlinks, submodules, binary/non-UTF-8 files, oversized files, runtime paths, and original planning/research paths are rejected.

Project verification adds a narrow `.agents/` exception: `.agents/AGENTS.md`, its pstack attribution license, and skill `SKILL.md` plus shallow Markdown `features/` and `references/` documents. It does not admit arbitrary agent files, executable helpers, settings, credentials or runtime state. Existing private-path, link, size, content and secret checks still apply to admitted documents. Regression tests check both accepted instructions and rejected agent state in working/index snapshots, including content rejection inside an admitted skill. `.pi/` remains private and ignored.

Formatting uses this same eligible path list, so it never walks the private holding folder. It is not a substitute for privacy checking or typechecking. `npm run typecheck` checks the repository's TypeScript scripts and tests with strict settings and `noEmit`; it is included in the root check. No application package exists yet.

## Commit and push

Pre-commit reads blobs from Git's index, including a staged version different from the working copy. Ignoring a file does not protect one already staged or tracked. Commit identities may use personal or noreply emails by choice; their contents are still checked for secrets. Commit-message also scans messages.

Pre-push runs the ordinary checks and the history gate. The history gate examines every commit reachable from local refs, including tags and remote-tracking refs. It checks identity metadata for secrets, recognized private information and secrets in messages, and each complete tree. Deleted private files in an old commit still block publication. This is conservative: even an unrelated local branch can block a push until reviewed. No ref deletion or history rewrite happens automatically.

## Secret scanning

Setup pins Gitleaks 8.30.1 and verifies its platform-specific release archive against SHA-256 values committed in `scripts/setup.ts`. System `tar` streams only the named binary from the checksum-verified archive; archive paths are never extracted onto the host. The scanner uses its built-in rules with no repo-wide allowlist. Checked snapshots are copied to a temporary folder, scanned, then removed. That temporary copy contains candidate public material, never ignored local folders.

Missing tooling, an execution error, or any finding fails the check. Raw scanner output and matched lines are suppressed so a failure cannot print a credential. Failures list categories rather than private filenames. To investigate, review your intended changes privately; never bypass the check or paste private input into an issue.

## CI and remaining limits

The workflow fetches full history, uses pinned action commits, disables checkout credential persistence, runs locked npm installs without lifecycle scripts, and has read-only repository access. It never uploads scan reports, logs, build artifacts, or runtime data. Do not add jobs that run untrusted PR code with privileged tokens.

The root npm package is private; it is not published by this setup. Dependabot proposes updates but cannot approve them. No automatic agent hooks or Claude-specific session processes are copied from the template.

Scanners cannot understand all personal context, screenshots, account names, encrypted or disguised secrets, or unknown formats. The optional local term file is not in CI. Hooks can be disabled, and CI runs after upload. Human review and actual GitHub rules remain required. Full-history scans favor safety over speed; optimize only after measurement, retaining old-commit and metadata coverage.

## Verification

Run `npm ci` and `npm run setup` before `npm test`. Pinned `tsx` executes TypeScript tests with Node's built-in runner, without emitting JavaScript files. Tests create disposable Git repositories with invented identities and data. They cover clean text, denied paths, index/worktree differences, forced staging, ignored tracked files, symlink escapes, private historical content, commit metadata, and a generated secret-shaped token. Additional tests cover checksum rejection, scanner version validation, preserving other hooks, invalid CLI arguments, and sanitized command errors. CLI entry detection resolves real paths so symlinked launch paths cannot silently skip checks. No account login, provider call, or paid model is involved.

Instruction-placement tests keep one public root README and require a local `AGENTS.md` whenever a workspace manifest is added. Whether a deeper non-package directory has genuinely distinct rules remains a review decision under the root placement policy; no test can infer that from folder names alone.

Run `npm run check` for the working tree and `npm run release:check` before publication. The release check intentionally fails while the original private history remains.
