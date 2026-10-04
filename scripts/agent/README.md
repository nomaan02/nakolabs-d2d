# scripts/agent: the queue runner

Owner tooling. Runs Grok session prompts headless through the Cursor CLI,
one after another, with automatic checks ("gates") between them.

- `run-queue.ps1`: runs the queue.
- `review-pack.ps1`: builds one review file per session for Claude.
- `lib.ps1`: shared helpers (do not run it directly).

Only `run-queue.ps1` commits, and only on `run/<batch>` branches, as
`wip(<session-id>)` checkpoints. Real commits land on `main` after Claude's
review (see "Land reviewed work").

## Folders (all inside `.handoff/`, which git ignores)

| Folder | What lands there |
|---|---|
| `queue/` | Prompts waiting to run, named `NN-<session-id>.md` (e.g. `01-ui-5-a2.md`). Run in name order. |
| `done/` | Prompts that passed. |
| `failed/` | Prompts that failed or had no runner block. |
| `reports/` | Grok's report per session, `<session-id>.md`. |
| `logs/` | Raw CLI log (`.jsonl`), gate results (`.gates.md`), tsc / eslint / check output. |
| `review/` | One review pack per session, `<session-id>.md`. This is what Claude reads. |

## Run a batch

```powershell
cd C:\Users\nomaa\Documents\nakolabs-d2d-parent\nakolabs-d2d
.\scripts\agent\run-queue.ps1 -Batch ui-5 -DryRun   # check the plan; runs nothing
.\scripts\agent\run-queue.ps1 -Batch ui-5           # run the whole queue
.\scripts\agent\run-queue.ps1 -Batch ui-5 -Max 1    # run only the next prompt
```

Options:

- `-Model grok-4.7-high` (default). Never a `-fast` model.
- `-TimeoutMinutes 45` (default). A session that runs longer is killed and fails.
- `-AgentArgs '--sandbox','disabled'` if shell commands fail inside the CLI sandbox.

Before it starts, the runner checks: the `agent` CLI exists, `.handoff/` and
`Claude outputs/` are git-ignored, the working tree is clean, and the queue is
not empty. Then it switches to `run/<batch>` (creating it from the current
branch if needed).

## Prompt conventions (Claude writes these)

Every prompt starts with a runner block. A prompt without one is never run.

```
<!-- runner
gate: auto
allow:
- components/field/mini-map.tsx
- lib/field/*
checks:
- npm run verify:ui1
-->
```

- `gate: auto`: the queue carries on after a pass.
- `gate: human`: the queue always stops after this session. Use it for every
  migration, RLS change, sync-queue change or database write.
- `db-writes: allowed`: only when the prompt grants an exact database write.
- `allow:`: files the session may change. `*` matches anything, including `/`.
  `[` and `]` are literal, so `app/(field)/[id]/page.tsx` works as written.
  Always allowed: `docs/BUILD-LOG.md`, `docs/CLAUDE-HANDOFF.md`,
  `docs/FIELD-TEST-BUILD-PLAN.md`. Migration sessions must list
  `supabase/migrations/*` and `lib/supabase/types.ts`.
- `checks:`: extra commands the runner runs after Grok. A non-zero exit fails
  the session.
- Edits are headed `### EDIT 1`, `### EDIT 2` and so on.

## What the gates check

A session PASSES only if all of these hold:

1. Grok exited normally, within the timeout.
2. The report has `EDIT n DONE` for every `EDIT n` in the prompt, no
   `NOT DONE`, and no `BLOCKED` or `PARTIAL` in capitals.
3. Every changed file is on the allow list. `.env*`, `.gitignore`,
   `scripts/agent/*` and the Cursor hook files are never allowed. Migration
   files are only allowed with `gate: human`.
4. The CLI log shows no `apply_migration` outside `gate: human`, no
   `execute_sql` with a write keyword unless `db-writes: allowed`, and no
   state-changing git command.
5. `npx tsc --noEmit` passes.
6. eslint passes on the changed files.
7. Every command under `checks:` passes.

On PASS: checkpoint commit of exactly the changed files, review pack, phone
ping, next prompt. On FAIL: nothing is committed, review pack, phone ping,
the queue STOPS.

## Land reviewed work on main

After Claude has reviewed the packs, Claude gives you the exact commands.
They look like this, once per session, in order:

```powershell
git switch main
git cherry-pick -n <checkpoint-sha>
git status --short
git commit -m "ui-5-a2: <summary from Claude>"
git push
```

When every session of the batch is landed: `git branch -D run/ui-5`.

## Recovery

**A session FAILED.** Its changes are still in the working tree, on
`run/<batch>`. Send Claude the review pack (`.handoff/review/<id>.md`).
Then either:

- Keep and fix: fix it in the Cursor IDE, rebuild the pack with
  `.\scripts\agent\review-pack.ps1 -Id <id>`, get Claude's OK, then
  `git add -A -- <the files>` and `git commit -m "wip(<id>): fixed by hand"`.
  Move the prompt from `.handoff\failed\` to `.handoff\done\` and run the
  queue again.
- Throw away: `git restore .` (undo edits to tracked files), then
  `git clean -n` (PREVIEW of new files that would be deleted), then
  `git clean -f` once the preview is right. Ask Claude for a fixed prompt
  and put it back in `.handoff\queue\`.

**"Working tree is not clean".** Run `git status --short`, then use one of
the two options above.

**"Stray files after the gates".** A gate created a file git does not
ignore (e.g. `tsconfig.tsbuildinfo`). Add it to `.gitignore` or delete it,
commit that on `main`, then run again.

## Troubleshooting

- No phone pings: check `$env:D2D_NTFY` in a NEW PowerShell window.
- Supabase tools fail in a migration session: run `agent mcp list`, then
  `agent mcp login <name>` for the Supabase server.
- Shell commands fail with permission or network errors: add
  `-AgentArgs '--sandbox','disabled'`.
- A session keeps timing out: split the prompt, or raise `-TimeoutMinutes`.
