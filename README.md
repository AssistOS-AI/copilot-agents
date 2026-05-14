# copilot-agents

Ploinky research-agent relay for explicit `@backend` chat tasks.

Deploy the bundle explicitly, then use `@open-interpreter` from
Copilot/WebMeet chat. Execution is relayed through `researchRelay` to
`openInterpreterAgent`, which runs the task in its own local bwrap sandbox
inside a container based on the shared `assistos/bwrap-runner` image.
Additional research tags require provider agents before they become active.
