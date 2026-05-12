---
id: DS009
title: AI Scientist Agent
status: planned
owner: copilot-agents-team
summary: Defines the optional heavy adapter for The AI Scientist workflows, templates, reviews, and manuscript outputs.
---

# DS009 - AI Scientist Agent

## Introduction

`aiScientistAgent` adapts The AI Scientist into Ploinky. It is an optional heavy research agent and must not be part of the default lightweight deployment path.

## Core Content

The agent should use prebuilt Python images with template-specific dependencies. CPU, GPU, and LaTeX variants must be modeled through profiles or image tags rather than hidden runtime assumptions.

The agent must store durable state under `.ploinky/data/aiScientistAgent`. It must keep generated runtime inputs under `.ploinky/agents/aiScientistAgent` or validated project output directories.

The agent may expose async tools such as:

- `scientist_generate_ideas`
- `scientist_run_experiment`
- `scientist_generate_paper`
- `scientist_review_paper`
- `scientist_status`
- `scientist_export`

Templates must be allow-listed. The adapter must validate template setup before running experiments and must not accept arbitrary unchecked template paths from user input.

Paper review should be available independently from full experiment execution. This gives users a lower-risk first integration and supports bounded testing.

Generated manuscript artifacts must preserve upstream responsible-use and disclosure requirements. The adapter must not strip or hide required disclosure text from paper outputs.

## Decisions & Questions

### Question #1: Why keep AI Scientist out of the default bundle profile?

Response:
The AI Scientist can involve heavy dependencies, long experiments, LaTeX output, and GPU-sensitive templates. Keeping it profile-gated prevents expensive or unsuitable workloads from starting in ordinary Explorer sessions.

### Question #2: Why implement review before full experiment execution?

Response:
Paper review is a narrower capability with lower runtime risk. It lets the repository validate wrapper, status, and artifact behavior before enabling larger experiment loops.

## Conclusion

`aiScientistAgent` must be optional, profile-gated, template-validated, and careful about generated manuscript disclosure requirements.
