export const BACKEND = 'web-search';
export const RELAY_AGENT = 'copilotProviderRelay';
export const PROVIDER_AGENT = 'webSearchAgent';
export const LIST_TOOL = 'copilot_provider_list_backends';
export const SUBMIT_TOOL = 'copilot_provider_task_submit';
export const PROVIDER_STATUS_TOOL = 'web_search_status';

const DEFAULT_TIMEOUT_MS = 60000;
const MAX_TASK_TIMEOUT_MS = 90000;
const DEFAULT_TTL_SECONDS = 86400;
const PROVIDER_TOKEN_RE = /(^|\s)@(?:web-search|search)(?=\s|$|[.,:;!?])/i;
const AGENT_MCP_CLIENT_MODULE = '/Agent/client/AgentMcpClient.mjs';

function trim(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function asArray(value) {
    return Array.isArray(value) ? value : [];
}

function parsePromptText(value) {
    const text = trim(value);
    if (!text) return {};
    try {
        const parsed = JSON.parse(text);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? parsed
            : { prompt: text };
    } catch {
        return { prompt: text };
    }
}

function normalizeTimeout(value) {
    if (value === undefined || value === null || value === '') {
        return DEFAULT_TIMEOUT_MS;
    }
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return DEFAULT_TIMEOUT_MS;
    }
    return Math.max(1000, Math.min(MAX_TASK_TIMEOUT_MS, Math.floor(numeric)));
}

async function loadAgentClientFactory() {
    const module = await import(AGENT_MCP_CLIENT_MODULE);
    if (typeof module.createAgentClient !== 'function') {
        throw new Error('Ploinky AgentMcpClient does not export createAgentClient');
    }
    return module.createAgentClient;
}

export async function callAgentTool(agent, toolName, input = {}, options = {}) {
    const createAgentClient = typeof options.createAgentClient === 'function'
        ? options.createAgentClient
        : await loadAgentClientFactory();
    const client = await createAgentClient(agent);
    const callOptions = {};
    Object.defineProperty(callOptions, 'userDelegationToken', {
        enumerable: true,
        get: () => options.invocationToken || '',
    });
    Object.defineProperty(callOptions, 'timeoutMs', {
        enumerable: true,
        get: () => options.timeoutMs,
    });
    try {
        return { result: await client.callTool(toolName, input || {}, callOptions) };
    } finally {
        await client.close?.();
    }
}

export function extractToolText(response) {
    const result = response && response.result ? response.result : response;
    if (typeof result === 'string') return result;
    if (result && Array.isArray(result.content)) {
        return result.content
            .filter((entry) => entry && entry.type === 'text' && typeof entry.text === 'string')
            .map((entry) => entry.text)
            .join('\n');
    }
    if (result && typeof result.text === 'string') return result.text;
    return '';
}

export function extractToolJson(response) {
    const result = response && response.result ? response.result : response;
    if (result && typeof result === 'object' && !Array.isArray(result)
        && !Array.isArray(result.content) && typeof result.text !== 'string') {
        return result;
    }
    const text = extractToolText(response).trim();
    if (!text) return {};
    return JSON.parse(text);
}

function normalizeArgs(args = {}) {
    const fromPrompt = parsePromptText(args.promptText);
    const context = args.context && typeof args.context === 'object' ? args.context : {};
    return {
        ...fromPrompt,
        ...args,
        prompt: trim(args.prompt || fromPrompt.prompt || args.promptText),
        workingDir: trim(args.workingDir || args.working_directory || fromPrompt.workingDir || context.workingDir || process.cwd()),
        origin: args.origin && typeof args.origin === 'object'
            ? args.origin
            : fromPrompt.origin && typeof fromPrompt.origin === 'object'
            ? fromPrompt.origin
            : context.webchatOrigin || {},
        invocationToken: trim(args.invocationToken || fromPrompt.invocationToken || context.invocationToken),
        timeoutMs: normalizeTimeout(args.timeoutMs ?? fromPrompt.timeoutMs),
        env: args.env || context.env || process.env,
        callAgentTool: typeof args.callAgentTool === 'function' ? args.callAgentTool : callAgentTool,
    };
}

function resultBase(overrides = {}) {
    return {
        ok: false,
        backend: BACKEND,
        cacheable: false,
        result_text: '',
        persistence_hint: {
            ku_type: 'agent.result.web-search',
            record_result: false,
            ttl_hint_seconds: null,
        },
        diagnostics: {},
        ...overrides,
    };
}

function findCatalogBackend(payload) {
    return asArray(payload?.backends).find((backend) => {
        return String(backend?.id || '').trim().toLowerCase() === BACKEND;
    }) || null;
}

function normalizeRelayAnswer(payload) {
    return String(
        payload?.final_answer
        || payload?.natural_language_output
        || payload?.error
        || 'Web search completed without a response.',
    ).trim();
}

async function checkProviderAvailability(input, backend) {
    const providerAgent = trim(backend?.provider?.agent) || PROVIDER_AGENT;
    if (!providerAgent) {
        return {
            ok: false,
            result_text: 'Web search is unavailable because the Copilot Provider Relay backend has no provider route.',
            diagnostics: { providerAvailability: 'not_deployed', missingProviderRoute: true },
        };
    }
    try {
        const status = extractToolJson(await input.callAgentTool(providerAgent, PROVIDER_STATUS_TOOL, {}, {
            invocationToken: input.invocationToken,
            timeoutMs: 30000,
            env: input.env,
        }));
        return { ok: true, providerAgent, status };
    } catch (error) {
        return {
            ok: false,
            result_text: `Web search is unavailable because provider agent ${providerAgent} is not reachable: ${error?.message || 'provider status failed'}`,
            diagnostics: {
                providerAvailability: 'not_deployed',
                providerAgent,
                providerStatusError: error?.message || String(error),
            },
        };
    }
}

function rememberLauncherResult(context, result, extra = {}) {
    if (context && typeof context === 'object') {
        if (!Array.isArray(context.providerLauncherResults)) {
            context.providerLauncherResults = [];
        }
        context.providerLauncherResults.push({
            launcher: 'launch-web-search',
            backend: BACKEND,
            prompt: extra.prompt || '',
            result,
        });
    }
    return result;
}

function finish(input, result) {
    return rememberLauncherResult(input?.context, result, { prompt: input?.prompt });
}

export async function action(args = {}) {
    const input = normalizeArgs(args);
    if (!input.prompt) {
        return finish(input, resultBase({
            result_text: 'Web search needs a search query.',
            diagnostics: { providerAvailability: 'active' },
        }));
    }
    if (PROVIDER_TOKEN_RE.test(input.prompt)) {
        return finish(input, resultBase({
            result_text: '`@web-search` is ordinary chat text now. I did not start a web search from that token.',
            diagnostics: { providerAvailability: 'active', deprecatedToken: true },
        }));
    }
    if (!input.invocationToken) {
        return finish(input, resultBase({
            result_text: 'Web search is unavailable in this chat because no router invocation token was provided.',
            diagnostics: { providerAvailability: 'disabled', missingInvocationToken: true },
        }));
    }

    let catalog = {};
    try {
        catalog = extractToolJson(await input.callAgentTool(RELAY_AGENT, LIST_TOOL, {}, {
            invocationToken: input.invocationToken,
            timeoutMs: 30000,
            env: input.env,
        }));
    } catch (error) {
        return finish(input, resultBase({
            result_text: `Web search is unavailable because the Copilot Provider Relay is not reachable: ${error?.message || 'relay lookup failed'}`,
            diagnostics: { providerAvailability: 'not_deployed', relayLookupError: error?.message || String(error) },
        }));
    }
    const catalogBackend = findCatalogBackend(catalog);
    if (!catalogBackend) {
        return finish(input, resultBase({
            result_text: 'Web search launcher is available, but the Copilot Provider Relay catalog does not currently expose the web-search backend.',
            diagnostics: { providerAvailability: 'not_deployed', missingBackend: BACKEND },
        }));
    }

    const providerAvailability = await checkProviderAvailability(input, catalogBackend);
    if (!providerAvailability.ok) {
        return finish(input, resultBase({
            result_text: providerAvailability.result_text,
            diagnostics: providerAvailability.diagnostics,
        }));
    }

    const submitArguments = {
        backend: BACKEND,
        prompt: input.prompt,
        origin: {
            type: 'semantic-copilot',
            surface: 'webchat',
            working_directory: input.workingDir,
            ...input.origin,
        },
        timeoutMs: input.timeoutMs,
    };

    try {
        const payload = extractToolJson(await input.callAgentTool(RELAY_AGENT, SUBMIT_TOOL, submitArguments, {
            invocationToken: input.invocationToken,
            timeoutMs: input.timeoutMs + 30000,
            env: input.env,
        }));
        const cacheable = Boolean(payload.cacheable ?? (payload.backend_ok && payload.ok));
        return finish(input, resultBase({
            ok: payload.ok !== undefined ? Boolean(payload.ok) : true,
            cacheable,
            result_text: normalizeRelayAnswer(payload),
            persistence_hint: {
                ku_type: 'agent.result.web-search',
                record_result: cacheable,
                ttl_hint_seconds: cacheable ? (payload.ttl_hint_seconds || DEFAULT_TTL_SECONDS) : null,
            },
            diagnostics: {
                providerAvailability: 'active',
                relayBackend: payload.backend || BACKEND,
                backendOk: payload.backend_ok ?? null,
                providerAgent: providerAvailability.providerAgent,
                sources: payload.sources || [],
            },
        }));
    } catch (error) {
        return finish(input, resultBase({
            result_text: `Web search task failed: ${error?.message || 'delegated task failed'}`,
            diagnostics: { providerAvailability: 'active', submitError: error?.message || String(error) },
        }));
    }
}
