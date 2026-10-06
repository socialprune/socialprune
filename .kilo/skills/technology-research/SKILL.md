---
name: technology-research
description: Use when a repo decision depends on current external tool, platform, standard, or best-practice evidence. Handles source identity, freshness, claim mapping, authority conflicts, comparison, uncertainty, and recommendation. Triggers on 'research', 'compare libraries', 'evaluate tool', 'best practice'.
version: 1.2.0
author: Workflow Lab
created: 2026-04-19
updated: 2026-07-27
---

# Technology Research

## Use when
- A tool, library, or workflow choice is not already frozen.
- Current external documentation or ecosystem direction matters.
- A recommendation must be justified with up-to-date sources.

## Do not use when
- The authority docs already settle the decision.
- The task is internal implementation with no external dependency choice.
- The task is mode/skill routing only; use `workflow-routing`.

## Behavior change
When loaded, the agent switches from assumption-based guidance to evidence-based recommendation:
1. freeze the open question and constraints,
2. gather authoritative, source-identified evidence,
3. map material claims to sources and resolve conflicts,
4. compare candidates,
5. recommend, abstain, or name the evidence that would flip the decision.

## Typical pairings
- `brainstorming` when research feeds a design choice.
- `workflow-routing` when tool choice changes execution path.
- `feature-implementation` after the decision is made.

## Outputs
- Short research summary.
- Claim-to-source map with source date/version/freshness.
- Comparison matrix including authority conflicts and operational tradeoffs.
- Recommendation or bounded abstention with confidence, uncertainty, and flip condition.

## Procedure

### 1. Define the research question
- What decision is open?
- What constraints matter: compatibility, maintenance, complexity, speed?
- Which local authority already constrains the answer, and what evidence would be decisive?
- What freshness window or version identity is required?

### 2. Gather sources
Prioritize:
- official documentation,
- authoritative maintainers,
- current release/migration guidance,
- high-signal implementation references.

For every material source, record:
- canonical URL or path,
- publisher/maintainer,
- publication or retrieval date,
- version, release, specification date, tag, or commit when available,
- authority class: standard/specification, official product docs, release notes, maintainer statement, observed implementation, or secondary analysis.

Stop once minimum decisive evidence is reached. Do not add secondary sources for decoration.

### 3. Compare options
For each option, assess:
- fit for the task,
- maturity,
- maintenance posture,
- integration cost,
- long-term risk.
- license/security constraints when adoption is possible,
- what is officially documented versus only a local compatibility hypothesis.

### 3.5 Map claims and conflicts
- Link every recommendation-bearing claim to one or more exact sources.
- If official sources disagree, prefer the newer, more specific, and higher-authority source only when its identity is clear.
- Record unresolved conflicts instead of silently blending them.
- Treat vendor performance claims as hypotheses until reproduced.
- When docs cannot prove version-sensitive runtime behavior, define the smallest safe canary or mark the claim unverified.

### 4. Recommend with confidence
- Choose one option only when the evidence supports a winner.
- State confidence as High / Medium / Low.
- Note when an alternative becomes preferable.
- State explicit uncertainty and the evidence that would change the recommendation.
- Return `needs_review` or bounded abstention when equally authoritative evidence remains unresolved.

### 4.5 External-capability admission handoff

Before recommending adoption of external code, a plugin, tool, MCP capability, or similar executable dependency, require a closed admission packet with compound identity, canonical platform paths, policy evidence, provenance evidence, recorded signature/trust evidence, approval/request identity, independent gate results, failure codes, and an admit/reject verdict.

Policy, provenance, signature, and approval are independent gates. Approval cannot override a failed gate. Research may recommend a later adoption decision; it never installs or activates the capability. Local trust stores, signature verification mechanics, and executable paths specialize in the target repo.

## Guardrails
- Do not present stale assumptions as current fact.
- Do not research after the decision is already frozen.
- Do not stop at feature lists; include operational tradeoffs.
- Do not hide source dates, versions, authority conflicts, or uncertainty.
- Do not describe a tested compatibility result when only documentation was reviewed.
- Do not recommend adoption as ready when the admission packet is missing or rejected.
- Do not install or activate external capability from a research recommendation.

## Completion checklist
- [ ] Research question defined
- [ ] Source identities, dates/versions, and freshness recorded
- [ ] Material claims mapped to sources
- [ ] Authority conflicts and uncertainty resolved or surfaced
- [ ] Options compared
- [ ] Recommendation, abstention, confidence, and flip condition delivered
