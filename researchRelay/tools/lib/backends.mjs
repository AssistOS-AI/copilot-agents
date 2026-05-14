// Catalog of research backends owned by copilot-agents.
//
// The relay does not own backend command strings, runtime ids, package
// versions, shim paths, or backend-specific sandbox calls. Active backends
// must declare a provider agent; the relay forwards tasks through MCP using
// the router invocation token, and each provider executes its own local bwrap
// sandbox inside its own container based on the shared bwrap-runner image.

export const RESEARCH_BACKENDS = Object.freeze([
    {
        id: 'open-interpreter',
        tags: ['open-interpreter', 'oi'],
        label: 'Open Interpreter',
        default_profile: 'default',
        provider: { agent: 'openInterpreterAgent', tool: 'open_interpreter_run_task' },
        description: 'Bounded local coding and analysis backend provided by the openInterpreterAgent. The provider executes tasks in its own local bwrap sandbox inside a container based on the shared bwrap-runner image.',
    },
]);

export function findBackend(id) {
    if (typeof id !== 'string' || !id.trim()) {
        return null;
    }
    const normalized = id.trim().replace(/^@+/, '').toLowerCase();
    return RESEARCH_BACKENDS.find((backend) => {
        if (backend.id === normalized) return true;
        return Array.isArray(backend.tags) && backend.tags.some((tag) => tag === normalized);
    }) || null;
}

export function publicBackendView(backend, env = process.env) {
    return {
        id: backend.id,
        tags: backend.tags,
        label: backend.label,
        default_profile: backend.default_profile,
        provider: backend.provider ? { agent: backend.provider.agent, tool: backend.provider.tool } : null,
        configured: isBackendConfigured(backend, env),
        description: backend.description,
    };
}

export function isBackendConfigured(backend, env = process.env) {
    if (!backend) return false;
    if (backend.provider) return true;
    return false;
}
