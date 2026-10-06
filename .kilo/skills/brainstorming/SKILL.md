---
name: brainstorming
description: Use when exploring implementation or architecture options before committing repo work. Handles option framing, tradeoff comparison, and recommendation-driven design choice. Triggers on 'design', 'brainstorm', 'explore options', 'what approach', 'how should we'.
version: 1.0.1
author: Workflow Lab
created: 2026-04-19
updated: 2026-07-25
---

# Brainstorming

## Use when
- More than one credible approach exists.
- A merge, simplification, or redesign needs explicit tradeoff analysis.
- The task could create taxonomy drift if implemented too quickly.

## Do not use when
- Authorities already freeze the exact shape to implement.
- The issue is debugging unknown failure behavior; use `bug-diagnosis`.
- The task is a tiny, obvious edit with no design choice.

## Behavior change
When loaded, the agent stops premature implementation and instead:
1. summarizes the problem,
2. compares alternatives,
3. recommends one path,
4. names the tradeoff that justified the decision.

## Typical pairings
- `workflow-routing` to choose the right lane after the design decision.
- `technology-research` if external patterns or tool choices influence the decision.
- `feature-implementation` after the approach is selected.

## Outputs
- Options table with recommendation.
- Chosen approach summary.
- Constraints and non-goals for implementation.

## Procedure

### 1. Frame the decision
- Define the exact question being decided.
- Separate fixed authority from open design space.

### 2. List viable options
- Usually 2-3 options are enough.
- Include one recommended path and explain why.

### 3. Compare tradeoffs
Assess each option for:
- clarity,
- blast radius,
- compatibility with frozen authorities,
- future drift risk,
- verification cost.

### 4. Recommend decisively
- State the recommended path.
- State why adjacent options lost.
- Carry the selected constraints into implementation.

## Guardrails
- Do not ask open-ended preference questions when evidence can support a recommendation.
- Do not invent extra options just to appear thorough.
- Do not treat brainstorming as a substitute for frozen authority.

## Completion checklist
- [ ] Decision framed clearly
- [ ] Alternatives compared
- [ ] Recommended path chosen
- [ ] Tradeoff stated plainly
