export const BACKEND = 'browser-use';
export const RELAY_AGENT = 'copilotProviderRelay';
export const PROVIDER_AGENT = 'browserUseAgent';
export const LIST_TOOL = 'copilot_provider_list_backends';
export const SUBMIT_TOOL = 'copilot_provider_task_submit';
export const PROVIDER_STATUS_TOOL = 'browser_use_status';

const DEFAULT_TIMEOUT_MS = 120000;
const MAX_TASK_TIMEOUT_MS = 300000;
const PROVIDER_TOKEN_RE = /(^|\s)@(?:browser-use|browser)(?=\s|$|[.,:;!?])/i;

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

function normalizeProvider(value, prompt = '') {
    const explicit = trim(value).toLowerCase();
    if (explicit) return explicit;
    if (/\bgemini\b/i.test(prompt)) return 'gemini';
    return 'chatgpt';
}

function resolveRouterUrl(env = process.env) {
    const explicit = String(env.PLOINKY_ROUTER_URL || '').trim();
    if (explicit) return explicit.replace(/\/+$/, '');
    const host = String(env.PLOINKY_ROUTER_HOST || '127.0.0.1').trim() || '127.0.0.1';
    const port = String(env.PLOINKY_ROUTER_PORT || '8080').trim() || '8080';
    return `http://${host}:${port}`;
}

export async function callAgentTool(agent, toolName, input = {}, options = {}) {
    const base = resolveRouterUrl(options.env || process.env);
    const url = new URL(`/mcps/${encodeURIComponent(agent)}/mcp`, base);
    const headers = {
        'content-type': 'application/json',
        accept: 'application/json',
    };
    if (options.invocationToken) {
        headers['x-ploinky-caller-jwt'] = options.invocationToken;
    }
    const controller = new AbortController();
    const timeoutMs = Math.max(1000, Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS);
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: Date.now(),
                method: 'tools/call',
                params: { name: toolName, arguments: input || {} },
            }),
            signal: controller.signal,
        });
        const text = await response.text();
        const parsed = text ? JSON.parse(text) : {};
        if (!response.ok || parsed?.error) {
            throw new Error(parsed?.error?.message || `router responded ${response.status}`);
        }
        return parsed;
    } finally {
        clearTimeout(timer);
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
        provider: normalizeProvider(args.provider || fromPrompt.provider, args.prompt || fromPrompt.prompt || args.promptText),
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
            ku_type: 'agent.result.browser-use',
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
        || 'Browser task completed without a response.',
    ).trim();
}

async function checkProviderAvailability(input, backend) {
    const providerAgent = trim(backend?.provider?.agent) || PROVIDER_AGENT;
    if (!providerAgent) {
        return {
            ok: false,
            result_text: 'Browser use is unavailable because the Copilot Provider Relay backend has no provider route.',
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
            result_text: `Browser use is unavailable because provider agent ${providerAgent} is not reachable: ${error?.message || 'provider status failed'}`,
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
            launcher: 'launch-browser-use',
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
            result_text: 'Browser use needs a task description.',
            diagnostics: { providerAvailability: 'active' },
        }));
    }
    if (PROVIDER_TOKEN_RE.test(input.prompt)) {
        return finish(input, resultBase({
            result_text: '`@browser-use` is ordinary chat text now. I did not start a browser task from that token.',
            diagnostics: { providerAvailability: 'active', deprecatedToken: true },
        }));
    }
    if (!input.invocationToken) {
        return finish(input, resultBase({
            result_text: 'Browser use is unavailable in this chat because no router invocation token was provided.',
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
            result_text: `Browser use is unavailable because the Copilot Provider Relay is not reachable: ${error?.message || 'relay lookup failed'}`,
            diagnostics: { providerAvailability: 'not_deployed', relayLookupError: error?.message || String(error) },
        }));
    }
    const catalogBackend = findCatalogBackend(catalog);
    if (!catalogBackend) {
        return finish(input, resultBase({
            result_text: 'Browser use launcher is available, but the Copilot Provider Relay catalog does not currently expose the browser-use backend.',
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
        provider: input.provider,
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

        if (payload.requires_user_action || payload.state === 'waiting_for_user') {
            return finish(input, resultBase({
                ok: true,
                result_text: `This task requires you to log in first. Please open the viewer to complete login, then the task will continue automatically.\n\nViewer URL: ${payload.viewerUrl || 'not available'}`,
                persistence_hint: {
                    ku_type: 'agent.result.browser-use',
                    record_result: false,
                    ttl_hint_seconds: null,
                },
                diagnostics: {
                    providerAvailability: 'active',
                    relayBackend: payload.backend || BACKEND,
                    backendOk: payload.backend_ok ?? null,
                    providerAgent: providerAvailability.providerAgent,
                    state: payload.state,
                    jobId: payload.jobId,
                    sessionId: payload.sessionId,
                    viewerUrl: payload.viewerUrl,
                    requires_user_action: true,
                    interactive: true,
                },
            }));
        }

        return finish(input, resultBase({
            ok: payload.ok !== undefined ? Boolean(payload.ok) : true,
            cacheable: false,
            result_text: normalizeRelayAnswer(payload),
            persistence_hint: {
                ku_type: 'agent.result.browser-use',
                record_result: false,
                ttl_hint_seconds: null,
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
            result_text: `Browser use task failed: ${error?.message || 'delegated task failed'}`,
            diagnostics: { providerAvailability: 'active', submitError: error?.message || String(error) },
        }));
    }
}
