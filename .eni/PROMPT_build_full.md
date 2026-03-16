# Build Mode (Full Session)

You are in BUILD mode for a multi-spec session. All specs share a single worktree and branch. Implement one task from beads, validate, and commit.

**Epic filter:** `{{EPIC_NAME}}` (current spec being built)

## Path Discovery Rules (CRITICAL)

**NEVER guess or invent file paths.** Always verify paths exist before referencing them.

Before editing ANY file:
1. Use Glob to find files matching a pattern
2. Use Grep to search for specific code
3. Verify the file exists before editing it

Wrong: `src/features/credits/components/CreditsBadge.tsx` (guessed)
Right: Run `Glob("**/CreditsBadge*")` first, then use the actual path returned

For new files (create): verify the parent directory exists first.

## Phase 0: Worktree Setup

Before any work, create or enter a git worktree for isolation.

**Branch and worktree are pre-computed by the CLI (shared across all specs in this session):**
- **Branch:** `{{BRANCH}}`
- **Worktree:** `{{WORKTREE}}`
- **Epic mode:** `{{IS_EPIC}}`

**Create worktree if it doesn't exist:**
```bash
BRANCH="{{BRANCH}}"
WORKTREE="{{WORKTREE}}"

if [ ! -d "$WORKTREE" ]; then
  # Create worktree with new branch (or existing branch if it exists)
  git worktree add "$WORKTREE" -b "$BRANCH" 2>/dev/null || git worktree add "$WORKTREE" "$BRANCH"
  cd "$WORKTREE"
  pnpm install
else
  cd "$WORKTREE"
fi
```

**IMPORTANT:** All work happens inside the worktree directory. Stay in `$WORKTREE` for the entire build session.

## Phase 0.5: Ready Task Pre-Check

Before claiming any work, verify there are tasks ready to work on:

```bash
ready=$(bd ready 2>/dev/null)
if [ -z "$ready" ]; then
  echo "NO READY TASKS."
  bd blocked 2>/dev/null  # Show blockers for context
fi
```

If no ready tasks exist:
1. Run `bd blocked` for context
2. If all tasks for `{{EPIC_NAME}}` are complete:
   - If `{{IS_LAST_SPEC}}` is `true` → go to **Phase 5: Create PR**
   - If `{{IS_LAST_SPEC}}` is `false` → output `:::ENI_DONE:::` and exit
3. Otherwise → output `:::ENI_DONE:::` and exit

## Phase 1: Check Ready Tasks

```bash
bd ready
```

**Epic mode (`{{IS_EPIC}}` = true):** Only consider tasks matching `{{EPIC_NAME}}` in their title or notes.

If no ready tasks:
1. Run `bd blocked` to see what's waiting
2. If ALL tasks for this epic/scope are complete:
   - If `{{IS_LAST_SPEC}}` is `true` → go to **Phase 5: Create PR**
   - If `{{IS_LAST_SPEC}}` is `false` → output `:::ENI_DONE:::` and exit
3. Otherwise, output `:::ENI_DONE:::` and exit

## Phase 2: Select & Claim Task

Pick the highest priority ready task (filtered by epic if specified):

```bash
bd show <task-id>
bd update <task-id> --status=in_progress
```

Read the task's description, design, and notes fields.

Before making changes, search the codebase to:
- Verify functionality doesn't already exist
- Understand existing patterns
- Identify files to modify

## Phase 3: Implement & Validate

### Tracer Bullet Mindset

Don't outrun your headlights. Build small, validate early, expand from working code.

- Build the **minimum** that satisfies acceptance criteria
- Test **immediately** after each small piece
- Get feedback before expanding
- Never build complete layers in isolation

If the task is a `[Tracer]` task, it MUST touch all layers end-to-end before moving on.

### Implementation

Follow:
- The design field in the bead
- Patterns in `AGENTS.md`
- Existing code conventions

**Test requirement:** Each implementation must include colocated `.test.ts` files.
- Exception: config/schema/static-data-only changes can skip test creation
- `pnpm test` always runs regardless of exception

After implementing, validate:
1. Run `Verify:` command from task notes - must pass
2. Run `pnpm build` - must pass
3. Run `pnpm lint` - must pass
4. Run `pnpm test` - must pass

If validation fails, fix and re-validate. Do NOT proceed until passing.

## Phase 4: Commit & Close

When validation passes:

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat({{EPIC_NAME}}): [task description]

Progress: [what was completed this commit]
Next: [what remains for this spec, or "none" if last task]
EOF
)"
bd close <task-id>
git push -u origin HEAD
```

**Commit message format is REQUIRED:**
- Line 1: `feat(epic): short description`
- Line 3: `Progress:` what this commit achieved
- Line 4: `Next:` remaining work (enables context recovery)

**STOP HERE.** Do not pick up another task. Do not run `bd ready` again.
Do NOT output `:::ENI_DONE:::` — the loop engine handles continuation.
Your job for this iteration is done.

## Phase 5: Create PR & Archive Specs

> **Only execute this phase when `{{IS_LAST_SPEC}}` is `true`.**
> If `{{IS_LAST_SPEC}}` is `false`, output `:::ENI_DONE:::` and exit instead.

When no ready tasks remain for this epic/scope:

1. Verify all tasks are closed:
   ```bash
   bd list --status=open  # Should show no tasks for this epic
   ```

2. Get completed tasks for PR body:
   ```bash
   bd list --status=done  # All tasks across all specs in this session
   ```

3. Create pull request with structured description:
   ```bash
   gh pr create --title "feat: build session {{BRANCH}}" --body "$(cat <<'EOF'
   ## Summary
   Multi-spec build session covering all planned specs.

   ### Completed Specs
   [List all specs built in this session]

   ### Completed Tasks
   [List beads closed across all specs - from bd list --status=done]

   ### Testing
   - `pnpm build && pnpm lint` passing
   - Manual: [describe what was manually tested]
   EOF
   )"
   ```

4. Archive fully-closed epic specs:
   Check which epics are now fully closed and archive their spec files:
   ```bash
   # List all epics
   bd list --type=epic
   # For each epic, check if all its child tasks are closed
   # If an epic is fully closed and specs/<epic-name>.md exists, archive it:
   mkdir -p specs/archive
   mv specs/<epic-name>.md specs/archive/
   ```
   Commit all archived specs together:
   ```bash
   git add specs/
   git commit -m "chore: archive completed epic specs"
   git push
   ```

5. Output completion signal:
   ```
   :::ENI_DONE:::
   ```

## Error Recovery

If validation fails:
1. First attempt: Targeted fix based on error
2. Second attempt: Alternative approach
3. Third attempt:
   - Create blocking bug: `bd create --type=bug --title="Fix: [error]"`
   - Do NOT commit broken code
   - Exit

## Guardrails

1. **Tracer bullets** — build small, test immediately, expand from working code
2. **Branch first** — ensure correct branch before any work
3. **Single task** — implement ONE task per iteration, then STOP (do not loop back to Phase 1)
4. **Epic filter** — only work on tasks matching epic if specified
5. **Validate before commit** — never commit failing code
6. **Close beads** — always `bd close` after committing
7. **PR gated on IS_LAST_SPEC** — only create PR when `{{IS_LAST_SPEC}}` is `true`
8. **Tests required** — create colocated `.test.ts` files for implementation code
9. **Shared worktree** — all specs share `{{WORKTREE}}`, do not create per-spec worktrees

## Command Reference

```bash
# Find work
bd ready              # Show unblocked tasks
bd blocked            # Show blocked tasks
bd show <id>          # Task details

# Claim work
bd update <id> --status=in_progress

# Complete work
bd close <id>         # Mark done

# Git (worktree)
git worktree add .worktrees/feat/<session> -b feat/<session>
gh pr create --title "..." --body "..."
```
