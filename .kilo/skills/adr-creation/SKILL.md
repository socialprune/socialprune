---
name: adr-creation
description: Use when documenting architecture decisions as ADRs. Handles decision records, rationale capture, alternative analysis. Triggers on 'create ADR', 'document decision', 'architecture decision record'.
---

# Skill: ADR Creation

## Metadata
- **ID:** SKILL-003
- **Version:** 2.0.1
- **Last Updated:** 2026-04-15
- **Author:** System Perfection Audit V3
- **Previous Version:** 1.0.0 by Pioneer Deep-Diver

## Trigger Phrases
- "Document this decision"
- "Create an ADR"
- "We need to decide between X and Y"
- "Architecture decision needed"
- "Why did we choose X?"
- "We decided to use X because..."
- "This is our pattern for..."
- "We're changing the architecture"
- "Record this as an ADR"
- "Important technical decision"

## Objective
Create a high-quality Architecture Decision Record (ADR) that documents the context, evaluates multiple options objectively, states the decision with clear reasoning, and tracks consequences for future reference.

## Activation in SocialPrune

Activated on 2026-10-06 from the workflow template's optional layer. In this repository:

- ADRs live in `docs/architecture/adrs/` and record the decisions contributors need, starting with those in the maintainer's `PLAN.md` section 3 (`docs/BACKLOG.md`, BL-002). They are public, so they carry no private paths, no real export content and nothing from `PLAN.md` section 14.
- Numbers in an ADR are measured or cited. Effort is a value measured on comparable work or `not measured`, never a guess (`.kilo/rules/pre-planning-mandate.md`, law 24).
- **Decision made by** is `maintainer`.
- ADR prose follows `.kilo/rules/human-writing-style.md`: no emojis, no em or en dashes, plain words.

Steps 1, 3 and 4 below carry these changes. The rest matches the template copy.

## Thinking Budget
**MEDIUM (5,000 tokens)**

Use higher budget (10,000 tokens) when:
- Decision involves multiple complex trade-offs
- Need to research options before evaluating
- Decision affects multiple domains or teams
- Security or data integrity implications

## Prerequisites

Before executing this skill, you MUST:

1. **Confirm ADR is Needed:**
   - New technology adoption? ✅
   - New pattern introduction? ✅
   - Breaking change? ✅
   - Security-relevant decision? ✅
   - Minor implementation detail? ❌ (no ADR)
   - Routine refactoring? ❌ (no ADR)

2. **Gather Context:**
   - Understand the problem being solved
   - Know the constraints (technical, business, timeline)
   - Identify stakeholders affected

3. **Read Existing ADRs:**
   - Check `docs/architecture/adrs/` for related decisions
   - Ensure not duplicating an existing ADR

## Steps

### Step 1: Determine ADR Number and Filename [2 min]

Find the highest existing number with the Glob tool on `docs/architecture/adrs/ADR-*.md` and add one. If the folder is empty or missing, start at ADR-001.

- Filename: `ADR-[NNN]-[slug].md`
- Example: `ADR-006-session-management.md`

**Slug Rules:**
- Lowercase kebab-case
- 2-4 words describing the decision
- No filler words ("using", "implementation", "for")

### Step 2: Write Context Section [10 min]

**Answer these 5 W's (MANDATORY):**

| Question | Must Answer |
|----------|-------------|
| **What** | What problem are we solving? |
| **Why** | Why is this decision necessary now? |
| **Who** | Who are the stakeholders? |
| **Where** | Where in the system does this apply? |
| **When** | When must this be decided? (Timeline) |

**Template:**
```markdown
## Context
[Describe the problem. What forces are at play? What constraints exist?]

## Decision Drivers
- [Driver 1: Quantified if possible, e.g., "Need to support 3 new platforms"]
- [Driver 2: e.g., "Current approach requires 4 weeks per platform"]
- [Driver 3: e.g., "Team velocity constrained to 2 engineers"]
```

### Step 3: Analyze Options [20 min]

**MANDATORY: Evaluate at least 2 options (preferably 3)**

For EACH option, document ALL of these:

| Element | Requirement | Example |
|---------|-------------|---------|
| Name | Short, descriptive (≤5 words) | "Plugin Registry Pattern" |
| Description | 1-3 sentences | How the approach works |
| Pros | At least 2 genuine advantages | Real benefits, not fluff |
| Cons | At least 2 genuine disadvantages | Real drawbacks, be honest |
| Effort | Value measured on comparable work, or `not measured` | "not measured" |
| Risk | Low/Medium/High with explanation | "Medium - new pattern for team" |

**Template:**
```markdown
### Option 1: [Name]
[Brief description of the approach]

**Pros:**
- [Pro 1 - quantified if possible]
- [Pro 2]

**Cons:**
- [Con 1 - quantified if possible]
- [Con 2]

**Effort:** [value measured on comparable work, or `not measured`]
**Risk:** [Low/Medium/High] - [explanation]
```

### Step 4: State the Decision [5 min]

**Template:**
```markdown
## Decision
We chose **Option [N]: [Name]** because [primary reason in 1-2 sentences].

[Optional: Secondary reasons, tie-breakers, stakeholder input]

**Decision made by:** maintainer
**Approved on:** [YYYY-MM-DD]
```

**Requirements:**
- Specific option named (not "the best one")
- Primary reason ties back to Decision Drivers
- Date recorded

### Step 5: Document Consequences [10 min]

**Template:**
```markdown
## Consequences

### Positive
- [Positive outcome 1 - quantified if possible]
- [Positive outcome 2]

### Negative
- [Tradeoff 1 - what we're giving up]
- [Tradeoff 2]

### Risks
- [Risk 1]: [Mitigation strategy]
- [Risk 2]: [Mitigation strategy]
```

**Requirements:**
- At least 2 positive consequences
- At least 1 negative consequence (BE HONEST)
- At least 1 risk with mitigation

### Step 6: Final Review [5 min]

Run through the validation criteria below before saving.

## Anti-Laziness Measures

### Mandatory Checklist (ALL must be checked)

- [ ] **5 W's Answered:** Context answers What, Why, Who, Where, When
- [ ] **Multiple Options:** At least 2 options evaluated (not just the chosen one)
- [ ] **Balanced Pros/Cons:** Each option has ≥2 pros AND ≥2 cons
- [ ] **Honest Negatives:** Negative consequences are genuine (not "might be slightly harder")
- [ ] **Quantified Where Possible:** Numbers included (effort, time, cost, performance)
- [ ] **Decision Rationale:** Decision states WHY, tied to Decision Drivers
- [ ] **Risk Mitigations:** Every risk has a mitigation strategy
- [ ] **No Placeholders:** No `[TODO]`, `[TBD]`, `...` in final document
- [ ] **Related ADRs Linked:** If this supersedes or relates to another ADR, linked

### Bias Detection Checklist

- [ ] **Options Presented Neutrally:** Not "Option 1: Good vs Option 2: Bad"
- [ ] **Cons Are Real:** Cons aren't strawman arguments
- [ ] **No Predetermined Outcome:** Analysis was done before decision (not reverse-engineered)
