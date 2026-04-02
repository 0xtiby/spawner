# Planning Mode: Spec → Beads

You are in PLANNING mode. Translate a spec into beads epics and issues.

**Spec:** `{{SPECS_DIR}}/{{SPEC_NAME}}.md`
**Iteration:** {{ITERATION}}

---

## Path Discovery Rules (CRITICAL)

**NEVER guess or invent file paths.** Always verify paths exist before referencing them.

Before referencing ANY file path:
1. Use Glob to find files matching a pattern
2. Use Grep to search for specific code
3. Verify the file exists before adding it to a beads design field or editing it

Wrong: `src/features/credits/components/CreditsBadge.tsx` (guessed)
Right: Run `Glob("**/CreditsBadge*")` first, then use the actual path returned

For new files (create): verify the parent directory exists first.

---

## Iteration 1: Create Beads

If this is iteration 1, create the epic and all issues.

### Step 1: Read the Spec

Read `{{SPECS_DIR}}/{{SPEC_NAME}}.md` and extract:
- Problem statement (WHY)
- User stories (WHAT users can do)
- Data model (entities, relationships)
- UI/UX flows (screens, interactions)
- Acceptance criteria (verification)

### Step 2: Explore Codebase

Before creating issues, validate assumptions against actual code:

- **Find files to modify:** Search for existing files related to the spec's entities and flows
- **Identify patterns:** Look at similar features already implemented for structure to follow
- **Check reusable code:** Find existing utilities, helpers, or components that can be reused
- **Verify data model:** Compare spec entities against current `prisma/schema.prisma`

This ensures the Files and Patterns sections in issue designs are accurate, not guessed.

### Step 3: Check for Duplicates

```bash
bd list --status=open
bd list --type=epic
```

Skip if beads already exist for this spec.

### Step 4: Create Epic

```bash
bd create --type=epic \
  --title="{{SPEC_SLUG}}: [One-line summary]" \
  --description="Implementation of {{SPECS_DIR}}/{{SPEC_NAME}}.md" \
  --priority=2
```

Note the epic ID (e.g., `beads-001`).

### Step 5: Create Issues

For each logical work unit, create an issue:

```bash
bd create --type=task \
  --title="[Action verb] [specific deliverable]" \
  --description="[What to implement]" \
  --design="## Context
[Why this task exists, dependencies]

## Acceptance Criteria
- [ ] [Specific deliverable 1]
- [ ] [Specific deliverable 2]

## Files
- \`path/to/file.ts\` (modify) — verified via Glob
- \`path/to/new-file.ts\` (create) — parent dir verified

## Patterns
- See \`path/to/example/\` for reference

## Tests
[Expected test cases: what to test and expected outcomes]

## Verify
[command to run]" \
  --notes="Epic: [epic-id]" \
  --priority=2
```

**Design field is REQUIRED** with all 5 sections. This enables any model to execute.

**Task granularity:** Each task should take ~2 minutes. If longer, break it down.

### Tracer Bullet Phase

The **first tasks** form a tracer bullet phase: one or more tasks that together build a minimal end-to-end slice touching all layers.

From _The Pragmatic Programmer_: Don't build horizontal layers in isolation. Build one vertical slice first, test it, get feedback, then expand.

**Example:** For a "credits system" feature:
- ❌ Wrong: Schema → all queries → all actions → all UI
- ✅ Right: Schema + one query + one action + one UI = tracer bullet, then expand

**How many tracer tasks?** Use the ~2 min granularity rule and your judgment:
- If the vertical slice fits in one task (~2 min), create one tracer task.
- If distinct layers (e.g., DB migration, API endpoint, UI component) each need meaningful work, split into multiple tracer tasks.

**Multi-task tracer example** (credits system):
```
Task 1: "Add credits column to user schema and seed data"
Task 2: "Create getCredits API query and deductCredits action"
Task 3: "Add credits display badge to user profile page"
```
All three are tracer tasks forming the minimal vertical slice. Non-tracer tasks expand from here.

After the tracer phase validates the approach, create remaining tasks that expand horizontally.

**Standard structure:**
1. **Tracer phase** (1+ tasks) — minimal e2e slice (DB → API → UI if applicable)
2. Schema issues: Remaining data model changes
3. Backend issues: Queries, actions, handlers
4. Frontend issues: Components, pages

**Note:** Branch creation and PR are handled by the build prompt, not here.

### Step 6: Add Dependencies

```bash
bd dep add <issue> <depends-on>
```

Patterns:
- Schema → API → UI
- Utils → features using them
- **Tracer → non-tracer:** All non-tracer tasks must depend on the last tracer task. This ensures the vertical slice validates the architecture before horizontal expansion begins.

### Step 7: Output Summary

```markdown
## Beads Created for: {{SPEC_NAME}}

**Epic:** [id] - [title]

### Issues ([count])

| ID | Title | Priority | Blocked By |
|----|-------|----------|------------|
| ... | ... | ... | ... |

### Dependency Graph

[ascii tree showing dependencies]

### Ready to Start

bd ready shows:
- [id]: [title]
```

---

## Iteration 2+: Refine Beads

If iteration > 1, review and improve existing beads.

### Step 1: Load Current State

```bash
bd list --status=open
bd show <epic-id>
```

### Step 2: Refinement Checklist

Review each issue against the spec:

- [ ] All user stories have corresponding issues?
- [ ] Acceptance criteria captured in descriptions?
- [ ] Dependencies model correct build order?
- [ ] Tasks are atomic (~2 min each)?
- [ ] Design fields have ALL 6 sections (Context, Acceptance Criteria, Files, Patterns, Tests, Verify)?
- [ ] Tests section present in design field with expected test cases?
- [ ] Verification commands are testable?

### Step 3: Update Issues

For issues needing improvement:

```bash
bd update <id> --design="[improved details]"
bd update <id> --description="[clarified scope]"
bd update <id> --notes="[better verification]"
```

Split large tasks:
```bash
bd create --type=task --title="[subtask 1]" ...
bd create --type=task --title="[subtask 2]" ...
bd dep add <subtask-2> <subtask-1>
```

### Step 4: Output Changes

```markdown
## Refinement Pass {{ITERATION}}

### Updated Issues
- [id]: [what changed]

### Added Issues
- [id]: [why added]

### Remaining Concerns
- [any issues that still need work]
```

### Step 5: Check if Done

If no meaningful improvements can be made, output:

```
:::TOBY_DONE:::
```

This signals the loop to stop early.

---

## Guardrails

1. **DO NOT implement** — only create/update beads
2. **DO NOT use TodoWrite** — beads is the tracker
3. **~2 minute tasks** — break down larger work
4. **Check duplicates** — scan beads before creating
5. **NO branch/PR tasks** — build prompt handles git workflow

## Command Reference

```bash
# Create
bd create --type=epic|task|bug --title="..." --priority=2
bd create --type=task --description="..." --design="..." --notes="..."

# Update
bd update <id> --design="..." --description="..." --notes="..."

# Dependencies
bd dep add <issue> <depends-on>

# View
bd list --status=open
bd ready
bd blocked
bd show <id>
```
