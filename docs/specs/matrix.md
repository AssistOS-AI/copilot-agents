# Specification Matrix

Generated from DS frontmatter following the GAMP specs workflow. Edit the DS files and regenerate this matrix instead of treating it as the source of truth.

| Specification | Title | Status | Owner | Summary |
| --- | --- | --- | --- | --- |
| [DS000](specsLoader.html?spec=DS000-vision.md) | Vision | [[status:planned]] | copilot-agents-team | Defines the purpose, boundaries, and success criteria for the Ploinky research agents repository. |
| [DS001](specsLoader.html?spec=DS001-coding-style.md) | Coding Style | [[status:implemented]] | copilot-agents-team | Establishes coding, layout, documentation, and testing conventions for the research agents repository. |
| [DS002](specsLoader.html?spec=DS002-ploinky-runtime-invariants.md) | Ploinky Runtime Invariants | [[status:planned]] | copilot-agents-team | Captures the routing, deployment, authentication, storage, and logging invariants every research agent must preserve. |
| [DS003](specsLoader.html?spec=DS003-agent-inventory.md) | Agent Inventory | [[status:planned]] | copilot-agents-team | Defines the research relay inventory, provider-backed backend ids, and default enablement posture. |
| [DS004](specsLoader.html?spec=DS004-research-agents-bundle.md) | Research Agents Bundle | [[status:planned]] | copilot-agents-team | Defines the explicit deployment bundle that enables the research relay suite without making it an Explorer default. |
| [DS005](specsLoader.html?spec=DS005-research-relay-agent.md) | Research Relay Agent (researchRelay) | [[status:planned]] | copilot-agents-team | Defines the Explorer-facing semantic research-task relay under the `researchRelay` agent id. |
| [DS006](specsLoader.html?spec=DS006-open-interpreter-agent.md) | Open Interpreter Provider Agent | [[status:planned]] | copilot-agents-team | Defines the Open Interpreter provider agent. The agent owns Open Interpreter runtime setup and executes tasks inside its own local bwrap sandbox. |
| [DS007](specsLoader.html?spec=DS007-openhands-agent.md) | OpenHands Backend | [[status:planned]] | copilot-agents-team | Reserves the future OpenHands provider backend contract. |
| [DS008](specsLoader.html?spec=DS008-agent-laboratory-agent.md) | Agentic Data Scientist Backend | [[status:planned]] | copilot-agents-team | Reserves the future Agentic Data Scientist provider backend contract. |
| [DS009](specsLoader.html?spec=DS009-ai-scientist-agent.md) | MLJAR and DeepAnalyze Backends | [[status:planned]] | copilot-agents-team | Reserves the future MLJAR and DeepAnalyze provider backend contracts. |
| [DS010](specsLoader.html?spec=DS010-achilles-cli-launch-integration.md) | AchillesCLI Semantic Copilot Integration | [[status:implemented]] | copilot-agents-team | Defines how AchillesCLI Copilot launches semantic provider tasks through deterministic launcher skills and the Research Relay. |
| [DS011](specsLoader.html?spec=DS011-security-observability.md) | Security and Observability | [[status:planned]] | copilot-agents-team | Defines safety, telemetry, logging, trace, transcript, artifact, and local sandbox rules for research-agent execution. |
| [DS012](specsLoader.html?spec=DS012-tagged-research-chat-relay.md) | Superseded Tagged Research Chat Relay | [[status:superseded]] | copilot-agents-team | Superseded by DS013; visible @tag dispatch is no longer the user contract. |
| [DS013](specsLoader.html?spec=DS013-semantic-copilot-routing.md) | Semantic Copilot Routing and Launcher Skills | [[status:implemented]] | copilot-agents-team | Defines semantic AchillesCLI Copilot routing, deterministic provider launchers, relay dispatch, and provider-result cacheability boundaries. |
| [DS014](specsLoader.html?spec=DS014-headless-search-agent.md) | Web Search Provider Agent | [[status:implemented]] | copilot-agents-team | Defines the cacheable web-search provider agent backed by its own local headless browser runtime. |
