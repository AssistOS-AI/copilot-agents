# copilot-agents

Ploinky provider-agent suite for semantic AchillesCLI Copilot tasks.

Deploy the bundle explicitly, then ask Copilot for provider-backed work in
natural language. Execution is relayed through `copilotProviderRelay` to
provider agents such as `openInterpreterAgent` and `webSearchAgent`.

All repository-owned agents remain image-backed containers. Their manifests
omit `lite-sandbox`; code-execution providers create their own inner Bubblewrap
sandboxes inside those containers.
