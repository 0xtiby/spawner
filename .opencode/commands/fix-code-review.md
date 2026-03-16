---
description: Fix code review comments from a GitHub PR
---

# Fix Code Review

Fetch review comments from a GitHub PR and fix them with approval before applying changes.

## Usage

`/fix-code-review <pr-url>`

Example: `/fix-code-review https://github.com/eniem-dev/eniem-boilerplate/pull/10`

## Process

1. **Fetch PR comments**: Use `gh` CLI to get all review comments
2. **Parse comments**: Extract file paths, line numbers, and feedback
3. **Show plan**: Display each comment and proposed fix
4. **Get approval**: Ask user to confirm before making changes
5. **Apply fixes**: Make the code changes
6. **Validate**: Run build/lint to ensure fixes don't break anything
7. **Summarize**: Show what was fixed

## Step 1: Fetch All Comments

GitHub PRs have 3 types of comments - fetch ALL of them:

```bash
# 1. Review comments (line-specific feedback on the diff) - MOST IMPORTANT
gh api repos/<owner>/<repo>/pulls/<pr-number>/comments

# 2. Reviews with their body comments (approve/request changes summary)
gh pr view <pr-number> --json reviews --repo <owner/repo>

# 3. Issue comments (general conversation, not tied to code lines)
gh pr view <pr-number> --json comments --repo <owner/repo>
```

**Important**: `gh pr view --json comments` returns conversation comments, NOT the line-specific review comments. You MUST use the API endpoint to get line-specific feedback.

Parse the response to extract:

**From review comments (API):**
- `path` - File path
- `line` or `original_line` - Line number
- `body` - Comment body (the feedback to address)
- `user.login` - Author
- `diff_hunk` - Context of the code being commented on

**From reviews:**
- `body` - Review summary comment
- `state` - APPROVED, CHANGES_REQUESTED, COMMENTED
- `author.login` - Reviewer

**From issue comments:**
- `body` - General feedback
- `author.login` - Commenter

## Step 2: Build Fix Plan

For each comment, analyze:
- What change is being requested?
- Which file/lines need modification?
- What's the proposed fix?

Present as a numbered list:

```
## Fix Plan

1. **src/lib/auth.ts:42** - "Add error handling for null user"
   → Add null check before accessing user properties

2. **src/components/Button.tsx:15** - "Use semantic HTML"
   → Change div to button element

3. **src/features/settings/index.ts:8** - "Missing export"
   → Add missing export statement
```

## Step 3: Get Approval

Use AskUserQuestion:
- "Apply all fixes?" → Yes / No / Let me select specific ones

If user selects specific ones, show checkboxes for each fix.

## Step 4: Apply Fixes

For each approved fix:
1. Read the file
2. Apply the change
3. Verify syntax is valid

## Step 5: Validate

Run validation (single commands, not in parallel):
```bash
pnpm build
pnpm lint
pnpm test
```

If validation fails:
- Show the error
- Attempt to fix
- Re-validate

## Step 6: Summarize

```
## Summary

Fixed 3/3 review comments:
- ✅ src/lib/auth.ts:42 - Added null check
- ✅ src/components/Button.tsx:15 - Changed to semantic button
- ✅ src/features/settings/index.ts:8 - Added export

Validation: ✅ Build passed, ✅ Lint passed, ✅ Tests passed

Ready to commit? (Don't commit automatically - let user decide)
```

## Step 7: Pattern Gap Detection

After fixing comments, analyze whether any fix reveals a gap between implementation and documented patterns:

1. **Compare with AGENTS.md** - Does the fix follow a pattern not documented?
2. **Check consistency** - Is this a recurring issue that could be prevented?
3. **Identify root cause** - Why did this gap happen?

If a gap is detected, use AskUserQuestion:
- "I noticed [describe gap]. Should I update AGENTS.md to document this pattern?"
- Options: "Yes, update docs" / "No, one-time fix" / "Let me explain"

Examples of detectable gaps:
- Using `console.log` instead of `logger` (already in AGENTS.md)
- Missing error handling pattern
- Inconsistent file naming
- Not using established abstractions

## Guardrails

- Always show plan before making changes
- Ask for approval before applying fixes
- Run validation after fixes
- Don't commit automatically - user decides
- If a comment is unclear, ask for clarification
- Handle PR URLs from any GitHub repo (parse owner/repo from URL)
- When detecting pattern gaps, propose documentation updates to prevent recurrence
