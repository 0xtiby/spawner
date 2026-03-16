# Spec Template

Use this template when writing the functional specification.

```markdown
# [Feature Name]

## Overview

[One paragraph: what this feature does and why it matters]

## Problem Statement

**Who:** [Target users]
**Problem:** [What problem they face]
**Impact:** [Cost of not solving / benefit of solving]

## Scope

### Included
- [What this feature covers]
- [Must-have behaviors for v1]

### Excluded
- [Explicitly not in this version]
- [Future phase considerations]

### Constraints
- [Non-functional requirements: performance, accessibility]
- [Platform/browser/device constraints]
- [Data volume expectations]

## User Stories

### Primary Flow

- [ ] As a [user], I can [action] so that [benefit]
- [ ] As a [user], I can [action] so that [benefit]

### Secondary Flows

- [ ] As a [user], I can [action] so that [benefit]

## Business Rules

### Permissions
- Rule 1: [condition] → [result]
- Rule 2: [condition] → [result]

### Validation
- [field]: [validation rules]
- [field]: [validation rules]

### Limits & Constraints
- [limit type]: [value]
- [constraint]: [description]

### Time-based Rules
- [rule]: [timing/expiration]

## Data Model

### Entities

**[Entity Name]**
| Property | Type | Description |
|----------|------|-------------|
| id | string | Unique identifier |
| ... | ... | ... |

### Relationships
- [Entity A] has many [Entity B]
- [Entity B] belongs to [Entity A]

### State Transitions

```
[Initial State] → [Trigger] → [Next State]
[Next State] → [Trigger] → [Final State]
```

## UI/UX Specification

### Screen: [Screen Name]

**Entry point:** [How user gets here]

**Layout:**
- [Component 1]: [Description]
- [Component 2]: [Description]

**States:**
| State | Display |
|-------|---------|
| Empty | [What user sees when no data] |
| Loading | [Loading indicator description] |
| Success | [Normal display] |
| Error | [Error message/display] |

**Interactions:**
| Element | Action | Result |
|---------|--------|--------|
| [Button] | Click | [What happens] |
| [Input] | Change | [What happens] |

### Screen: [Next Screen Name]

[Repeat structure]

### Navigation Flow

```
[Screen A] → [action] → [Screen B]
[Screen B] → [action] → [Screen C]
[Screen B] → [back] → [Screen A]
```

## Edge Cases

### Error Scenarios

| Scenario | Expected Behavior |
|----------|-------------------|
| Network failure | [How app responds] |
| Invalid input | [Validation feedback] |
| Unauthorized | [Redirect/message] |
| Timeout | [Retry behavior] |

### Boundary Conditions

| Condition | Expected Behavior |
|-----------|-------------------|
| Empty list | [Empty state UI] |
| Max items reached | [Limit message] |
| Concurrent edit | [Conflict resolution] |

## Acceptance Criteria

### [User Story 1]

- [ ] **Given** [precondition], **when** [action], **then** [result]
- [ ] **Given** [precondition], **when** [action], **then** [result]

### [User Story 2]

- [ ] **Given** [precondition], **when** [action], **then** [result]
```

## Template Usage Notes

- Fill all sections relevant to the feature
- Remove sections that don't apply
- Be specific in acceptance criteria (testable conditions)
- Data model should describe logical entities, not database tables
- UI spec should be detailed enough to design screens
- Include all states a user might encounter
