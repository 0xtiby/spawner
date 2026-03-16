---
name: functional-spec-interview
description: Create detailed functional specifications through structured user interviews. Use when user says '/functional-spec', 'spec interview', 'create a spec', 'define requirements', or wants to document a feature before implementation. First decomposes the feature into focused topics of concern, then interviews per topic to produce behavioral specs covering user stories, business rules, and UI/UX that another agent can use to create implementation plans.
---

# Functional Spec Interview

Create functional specifications through adaptive interview using AskUserQuestion tool.
Features are first decomposed into focused topics of concern, then each topic goes through a structured interview producing one spec file.

## Usage

`/functional-spec <feature-name>`

Example: `/functional-spec user-onboarding`

## Process Overview

1. **Topic Decomposition** - Break the feature into focused topics of concern
2. **Per-topic interview** (steps 2–10 repeated for each topic):
   - **Context Discovery** - Understand what user already knows
   - **Problem & Users** - Who has the problem, why it matters
   - **Scope Definition** - What's in, what's out, boundaries
   - **User Stories** - What users can do (behaviors)
   - **Business Rules** - Conditions and logic governing the feature
   - **UI/UX Flows** - Screens, interactions, states
   - **Edge Cases** - Error states, limits, exceptions
   - **Acceptance Criteria** - How to verify success
   - **Resolve Open Questions** - Batch-ask unresolved items until none remain
3. **Write Specs** - Output one file per topic to `specs/<topic-name>.md`
4. **Specs Audit** - Review all specs for implementation leakage before handoff to planner

## Interview Guidelines

**Adaptive questioning:**
- Start with grouped questions (2-3 related questions)
- Go deeper on complex or unclear areas
- Skip obvious follow-ups when answers are comprehensive

**Question framing:**
- Use AskUserQuestion with clear options when choices exist
- Ask open-ended questions for exploration
- Summarize understanding before moving to next section

**Depth over breadth:**
- Better to fully understand one area than superficially cover all
- Ask "why" to uncover real requirements vs assumed solutions
- Challenge vague requirements ("fast" → "under 200ms")

## Interview Sections

### 1. Topic Decomposition

**Do this BEFORE any deep interview.** Break the feature into focused topics of concern.

**The one-sentence test:** Each topic must be describable in one sentence WITHOUT using "and" to join separate responsibilities.

- ✅ "Account registration via email and password" — one coherent topic (email/password is one auth method)
- ❌ "User onboarding handles registration, profile setup, and email verification" — three separate topics

**Process:**
1. Ask the user to describe the feature at a high level
2. Propose a topic breakdown as a numbered list
3. For each proposed topic, state the one-sentence description
4. Ask the user to validate, merge, or split topics
5. Lock the topic list before proceeding

**Example decomposition:**

User says: `/functional-spec user-onboarding`

Proposed topics:
```
1. Account registration — New users create an account with email/password
2. Profile completion — New users fill in required profile information after registration
3. Email verification — New users verify their email address to activate their account
4. Welcome flow — First-time users are guided through key features after activation
```

Each topic becomes one spec file: `specs/01-account-registration.md`, `specs/02-profile-completion.md`, etc.

**After validation:** Run steps 2–10 for EACH topic. You may batch shared context (Problem & Users is often the same across topics) but each topic gets its own Scope, User Stories, Business Rules, UI/UX, Edge Cases, and Acceptance Criteria.

### 2. Context Discovery

Start here for each topic. Understand what's already known.

- What sparked this feature idea?
- Any existing docs, sketches, or prior discussions?
- What's the urgency/priority?

If context was already covered for a previous topic in this session, summarize what carries over and ask only what's new for this topic.

### 3. Problem & Users

**Target users:**
- Who is the primary user?
- Are there secondary users with different needs?
- What's their current workaround?

**Problem statement:**
- What problem does this solve?
- What's the cost of not solving it?
- How will users' lives improve?

### 4. Scope Definition

Draw clear boundaries before going deeper.

**Inclusions:**
- What should this topic include?
- What are the must-have behaviors for v1?
- Are there related features this touches?

**Exclusions:**
- What should it explicitly NOT do?
- What's a future phase vs this phase?
- Any adjacent topics we should avoid scope-creeping into?

**Constraints:**
- Any non-functional requirements? (performance, accessibility, device support)
- Platform or browser constraints?
- Data volume expectations?

### 5. User Stories

Extract concrete behaviors users can perform.

Format: "As a [user], I can [action] so that [benefit]"

**Discovery questions:**
- Walk me through a typical user's journey for this topic
- What's the first thing a user does?
- What happens next? And after that?
- Are there different paths for different users?

### 6. Business Rules

Uncover the logic and conditions.

**Discovery questions:**
- What conditions must be true for [action] to work?
- Are there limits? (max items, rate limits, quotas)
- What permissions are required?
- Are there time-based rules? (expiration, scheduling)
- What validates input? What's rejected?

### 7. UI/UX Flows

Detail the interface and interactions.

**Screens:**
- What screens/pages are needed?
- What's the entry point?
- What navigation exists between screens?

**Components per screen:**
- What does the user see?
- What can they interact with?
- What feedback do they receive?

**States per component:**
- Empty state (no data)
- Loading state
- Success state
- Error state
- Disabled state (when applicable)

**Interactions:**
- What happens on click/tap?
- Are there hover states?
- Keyboard shortcuts?
- Mobile considerations?

### 8. Edge Cases

Explore boundaries and failures.

**Error scenarios:**
- What if network fails?
- What if user lacks permissions?
- What if data is invalid?
- What if dependent service is down?

**Boundary conditions:**
- What's the max/min allowed?
- What if list is empty?
- What if list has 10,000 items?
- What about concurrent access?

### 9. Acceptance Criteria

Define testable success conditions.

For each user story, define:
- Given [precondition]
- When [action]
- Then [expected result]

**Criteria must be behavioral and observable.** Focus on what a user or test can verify from the outside, not internal mechanics.

### 10. Resolve Open Questions

Before writing the spec, collect and resolve every remaining uncertainty.

- Review all sections for unanswered questions, ambiguous requirements, or placeholder decisions
- Present all unresolved items in a single AskUserQuestion call, grouped by section
- If answers surface new questions, repeat until zero open questions remain
- Incorporate each answer into the relevant spec section — do not create a separate "Open Questions" section

## Output

After all open questions are resolved for all topics, create one spec file per topic:

- File naming: `specs/XX-topic-name.md` (zero-padded prefix, kebab-case)
- Use template in `references/spec-template.md`
- Cross-reference between specs by filename when topics have dependencies (e.g., "Requires active account — see `01-account-registration.md`")

## Specs Audit

**After ALL spec files are written, run this audit before handing off to the planner.**

Review each spec file against these checks:

### Implementation leakage check

Scan for and remove any:
- ❌ Framework or library names (React, Prisma, Next.js, BetterAuth...)
- ❌ Code snippets, pseudocode, or function signatures
- ❌ Database column names, schema definitions, or SQL
- ❌ API endpoint paths or HTTP methods
- ❌ File paths or directory structures
- ❌ Variable names or type definitions
- ❌ Specific algorithm choices ("use K-means", "implement with a queue")

**Rewrite violations as behavioral outcomes:**
- ❌ "Add a `credits` column (integer) to the `users` table" → ✅ "Each user has a credit balance that persists across sessions"
- ❌ "Use Prisma to create a CreditTransaction model" → ✅ "Credit changes are tracked with amount, reason, and timestamp"
- ❌ "POST /api/credits/deduct" → ✅ "Users can spend credits, which reduces their balance immediately"
- ❌ "Use React Query for data fetching" → ✅ "Credit balance reflects recent changes without manual page refresh"

### Data model migration check

If any spec contains entity definitions, property lists, relationships, or state machine diagrams expressed as implementation structures:
1. Rewrite as behavioral descriptions: "Users have a balance" not "User { balance: int }"
2. State transitions become behavioral flows: "A request moves from pending to approved when an admin accepts it" not "status enum: pending | approved | rejected"
3. Relationships become user-facing facts: "Each user can belong to multiple teams" not "many-to-many via UserTeam join table"

The planner's codebase exploration step (PROMPT_plan Step 2) handles mapping these behaviors to actual schemas, models, and files. Specs don't need to do this work.

### Scope coherence check

For each spec, verify:
- Can this topic be described in one sentence without "and"?
- Does it overlap with another spec? If yes, move shared content to one spec and cross-reference.
- Are acceptance criteria observable from the user's perspective (not internal system checks)?

### Audit output

After the audit, present a summary:

```
## Specs Audit Results

### specs/01-account-registration.md
- ✅ No implementation leakage
- ✅ Scope is focused
- ⚠️ Fixed: Replaced "bcrypt password hashing" with "passwords are stored securely and cannot be retrieved in plain text"

### specs/02-profile-completion.md
- ✅ Clean
```

If any spec required changes, show the before/after for user confirmation before finalizing.

## Guardrails

- This is a FUNCTIONAL spec, not implementation spec
- Capture WHAT and WHY, never HOW to build
- No code, no technical architecture, no file paths, no schema definitions
- No framework names, library names, or algorithm choices
- Focus on user-facing behavior and business logic
- Data modeling belongs to the planner — specs describe behaviors, not structures
- The spec should be detailed enough for another agent to create an implementation plan
- The final spec must contain zero open questions — every decision point must be resolved during the interview
- One topic of concern = one spec file. If you need "and" to describe it, split it.
