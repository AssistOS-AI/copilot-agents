// Catalog of Copilot provider backends owned by copilot-agents.
//
// The relay does not own backend command strings, runtime ids, package
// versions, shim paths, or backend-specific sandbox calls. Active backends
// must declare a provider agent; the relay forwards tasks through MCP using
// the router invocation token, and each provider executes its own local bwrap
// sandbox inside its own container based on the shared bwrap-runner image.

export const COPILOT_PROVIDER_BACKENDS = Object.freeze([
    {
        id: 'open-interpreter',
        label: 'Open Interpreter',
        default_profile: 'default',
        provider: { agent: 'openInterpreterAgent', tool: 'open_interpreter_run_task' },
        description: 'Bounded local coding and analysis backend provided by the openInterpreterAgent. The provider executes tasks in its own local bwrap sandbox inside a container based on the shared bwrap-runner image.',
    },
    {
        id: 'web-search',
        label: 'Web Search',
        default_profile: 'default',
        provider: { agent: 'webSearchAgent', tool: 'web_search_run_task' },
        cacheable: true,
        ttl_hint_seconds: 86400,
        description: 'Cacheable web-search provider backed by the webSearchAgent local headless browser runtime.',
    },
]);

export function findBackend(id) {
    if (typeof id !== 'string' || !id.trim()) {
        return null;
    }
    const normalized = id.trim().toLowerCase();
    return COPILOT_PROVIDER_BACKENDS.find((backend) => backend.id === normalized) || null;
}

export function publicBackendView(backend, env = process.env) {
    return {
        id: backend.id,
        label: backend.label,
        default_profile: backend.default_profile,
        provider: backend.provider ? { agent: backend.provider.agent, tool: backend.provider.tool } : null,
        cacheable: Boolean(backend.cacheable),
        ttl_hint_seconds: backend.ttl_hint_seconds ?? null,
        configured: isBackendConfigured(backend, env),
        description: backend.description,
    };
}

export function isBackendConfigured(backend, env = process.env) {
    if (!backend) return false;
    if (backend.provider) return true;
    return false;
}
