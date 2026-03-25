# Build Mode

You are in BUILD mode. Implement one task from beads, validate, and commit.

**Spec:** `{{SPECS_DIR}}/{{SPEC_NAME}}.md`
**Iteration:** {{ITERATION}}
**Session:** {{SESSION}}
**Progress:** spec {{SPEC_INDEX}} of {{SPEC_COUNT}}
**All specs:** {{SPECS}}

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

**Branch and worktree naming:**
- **Single spec** (`{{SPEC_COUNT}}` = 1): branch and worktree = `feat/{{SPEC_SLUG}}`
- **Multiple specs** (`{{SPEC_COUNT}}` > 1): branch and worktree = `{{SESSION}}`

```bash
# Determine branch/worktree name
if [ "{{SPEC_COUNT}}" = "1" ]; then
  BRANCH="feat/{{SPEC_SLUG}}"
else
  BRANCH="{{SESSION}}"
fi
WORKTREE=".worktrees/$BRANCH"

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
  exit 1
fi
```

If no ready tasks exist, **STOP** and report. Blocked tasks may exist alongside ready tasks — that's normal. Only stop when nothing is actionable.

## Phase 1: Check Ready Tasks

```bash
bd ready
```

Only consider tasks matching `{{SPEC_SLUG}}` in their title or notes.

If no ready tasks:
1. Run `bd blocked` to see what's waiting
2. If ALL tasks for this spec are complete → go to **Phase 6: Create PR**
3. Otherwise, output `:::TOBY_DONE:::` and exit

## Phase 2: Select & Claim Task

Pick the highest priority ready task:

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
feat({{SPEC_SLUG}}): [task description]

Progress: [what was completed this commit]
Next: [what remains for this spec, or "none" if last task]
EOF
)"
bd close <task-id>
git push -u origin HEAD
```

**Commit message format is REQUIRED:**
- Line 1: `feat(spec-slug): short description`
- Line 3: `Progress:` what this commit achieved
- Line 4: `Next:` remaining work (enables context recovery)

**STOP HERE.** Do not pick up another task. Do not run `bd ready` again.
Do NOT output `:::TOBY_DONE:::` — the loop engine handles continuation.
Your job for this iteration is done.

## Phase 5: Create PR

**When to create a PR:**
- **Single spec** (`{{SPEC_COUNT}}` = 1): Create PR when all tasks for `{{SPEC_SLUG}}` are complete.
- **Multiple specs** (`{{SPEC_COUNT}}` > 1): Create PR only when this is the last spec (`{{SPEC_INDEX}}` = `{{SPEC_COUNT}}`). If `{{SPEC_INDEX}}` < `{{SPEC_COUNT}}`, output `:::TOBY_DONE:::` instead — the next spec will be handled by the loop engine.

When no ready tasks remain and it's time to create a PR:

1. Verify all tasks are closed:
   ```bash
   bd list --status=open  # Should show no tasks for this spec
   ```

2. Get completed tasks for PR body:
   ```bash
   bd list --status=done
   ```

3. Create pull request:

   **Single spec:**
   ```bash
   gh pr create --title "feat: {{SPEC_SLUG}}" --body "$(cat <<'EOF'
   ## Summary
   Implements {{SPECS_DIR}}/{{SPEC_NAME}}.md

   ### Completed Tasks
   [List beads closed for this spec - from bd list --status=done]

   ### Testing
   - `pnpm build && pnpm lint` passing
   - Manual: [describe what was manually tested]
   EOF
   )"
   ```

   **Multiple specs (last spec):**
   ```bash
   gh pr create --title "feat: {{SESSION}}" --body "$(cat <<'EOF'
   ## Summary
   Multi-spec build session covering: {{SPECS}}

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

4. Output completion signal:
   ```
   :::TOBY_DONE:::
   ```

## Error Recovery

If validation fails:
1. First attempt: Targeted fix based on error
2. Second attempt: Alternative approach
3. Third attempt:
   - Create blocking bug: `bd create --type=bug --title="Fix: [error]"`
   - Do NOT commit broken code
   - Exit with `:::TOBY_DONE:::`

## Guardrails

1. **Tracer bullets** — build small, test immediately, expand from working code
2. **Worktree first** — ensure correct worktree before any work
3. **Single task** — implement ONE task per iteration, then STOP (do not loop back to Phase 1)
4. **Validate before commit** — never commit failing code
5. **Close beads** — always `bd close` after committing
6. **Tests required** — create colocated `.test.ts` files for implementation code
7. **Verify paths** — use Glob/Grep before editing files
8. **Commit format** — use Progress/Next annotation for context recovery
9. **PR gating** — single spec: PR at end; multi-spec: PR only on last spec

## Command Reference

```bash
# Worktree
git worktree add .worktrees/feat/<slug> -b feat/<slug>
git worktree add .worktrees/<session> -b <session>

# Find work
bd ready              # Show unblocked tasks
bd blocked            # Show blocked tasks
bd show <id>          # Task details

# Claim work
bd update <id> --status=in_progress

# Complete work
bd close <id>         # Mark done

# Git
gh pr create --title "..." --body "..."
```
