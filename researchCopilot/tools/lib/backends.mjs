// Catalog of research backends owned by copilot-agents. Keep this list in
// sync with docs/specs/DS003-agent-inventory.md.

export const RESEARCH_BACKENDS = Object.freeze([
    {
        id: 'open-interpreter',
        agent: 'openInterpreterAgent',
        label: 'Open Interpreter',
        status_tool: 'oi_status',
        default_profile: 'default',
        description: 'Bounded local coding and analysis adapter.',
    },
    {
        id: 'openhands',
        agent: 'openHandsAgent',
        label: 'OpenHands',
        status_tool: 'openhands_status',
        default_profile: 'qa',
        description: 'Constrained OpenHands headless adapter (profile-gated).',
    },
    {
        id: 'agent-lab',
        agent: 'agentLaboratoryAgent',
        label: 'Agent Laboratory',
        status_tool: 'lab_status',
        default_profile: 'prod',
        description: 'Phase-driven Agent Laboratory adapter (profile-gated).',
    },
    {
        id: 'ai-scientist',
        agent: 'aiScientistAgent',
        label: 'AI Scientist',
        status_tool: 'scientist_status',
        default_profile: 'prod',
        description: 'AI Scientist adapter; paper review first (profile-gated).',
    },
]);

export function findBackend(id) {
    if (typeof id !== 'string' || !id.trim()) {
        return null;
    }
    const normalized = id.trim().toLowerCase();
    return RESEARCH_BACKENDS.find((b) => b.id === normalized || b.agent.toLowerCase() === normalized) || null;
}
