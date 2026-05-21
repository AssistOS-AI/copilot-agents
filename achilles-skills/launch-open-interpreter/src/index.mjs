export const BACKEND = 'open-interpreter';
export const RELAY_AGENT = 'copilotProviderRelay';
export const PROVIDER_AGENT = 'openInterpreterAgent';
export const LIST_TOOL = 'copilot_provider_list_backends';
export const SUBMIT_TOOL = 'copilot_provider_task_submit';
export const PROVIDER_STATUS_TOOL = 'oi_status';

const DEFAULT_TIMEOUT_MS = 110000;
const MAX_TASK_TIMEOUT_MS = 120000;
const PROVIDER_TOKEN_RE = /(^|\s)@open-interpreter(?=\s|$|[.,:;!?])/i;

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
        workingDir: trim(args.workingDir || args.working_directory || fromPrompt.workingDir || context.workingDir || process.cwd()),
        resources: asArray(args.resources?.length ? args.resources : fromPrompt.resources?.length ? fromPrompt.resources : context.webchatResources),
        paths: asArray(args.paths?.length ? args.paths : fromPrompt.paths?.length ? fromPrompt.paths : context.webchatPaths),
        origin: args.origin && typeof args.origin === 'object'
            ? args.origin
            : fromPrompt.origin && typeof fromPrompt.origin === 'object'
            ? fromPrompt.origin
            : context.webchatOrigin || {},
        warnings: asArray(context.webchatResourceWarnings),
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
            ku_type: 'code_work',
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
        || 'Open Interpreter completed without a response.'
    ).trim();
}

function withForwardingWarnings(prompt, warnings = []) {
    const cleanWarnings = warnings.map((entry) => trim(entry)).filter(Boolean);
    if (!cleanWarnings.length) return prompt;
    return `${prompt}\n\nReference forwarding notes:\n${cleanWarnings.map((entry) => `- ${entry}`).join('\n')}`;
}

function normalizeForwardablePaths(paths = []) {
    const forwarded = [];
    const warnings = [];
    for (const entry of asArray(paths)) {
        if (typeof entry === 'string') {
            const text = trim(entry);
            if (text) forwarded.push(text);
            continue;
        }
        if (!entry || typeof entry !== 'object') continue;
        const entryPath = trim(entry.path);
        if (!entryPath) continue;
        if (String(entry.type || '').toLowerCase() === 'file') {
            forwarded.push(entryPath);
            continue;
        }
        const label = trim(entry.label) || entryPath;
        warnings.push(`Workspace reference "${label}" is a ${trim(entry.type) || 'non-file'} path and was not forwarded as a relay path. Attach or reference specific files to send file paths.`);
    }
    return {
        paths: [...new Set(forwarded)],
        warnings,
    };
}

async function checkProviderAvailability(input, backend) {
    const providerAgent = trim(backend?.provider?.agent) || PROVIDER_AGENT;
    if (!providerAgent) {
        return {
            ok: false,
            result_text: 'Open Interpreter is unavailable because the Copilot Provider Relay backend has no provider route.',
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
            result_text: `Open Interpreter is unavailable because provider agent ${providerAgent} is not reachable: ${error?.message || 'provider status failed'}`,
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
            launcher: 'launch-open-interpreter',
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
            result_text: 'Open Interpreter needs a natural-language task to run.',
            diagnostics: { providerAvailability: 'active' },
        }));
    }
    if (PROVIDER_TOKEN_RE.test(input.prompt)) {
        return finish(input, resultBase({
            result_text: '`@open-interpreter` is ordinary chat text now. I did not start Open Interpreter from that token.',
            diagnostics: { providerAvailability: 'active', deprecatedToken: true },
        }));
    }
    if (!input.invocationToken) {
        return finish(input, resultBase({
            result_text: 'Open Interpreter is unavailable in this chat because no router invocation token was provided.',
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
            result_text: `Open Interpreter is unavailable because the Copilot Provider Relay is not reachable: ${error?.message || 'relay lookup failed'}`,
            diagnostics: { providerAvailability: 'not_deployed', relayLookupError: error?.message || String(error) },
        }));
    }
    const catalogBackend = findCatalogBackend(catalog);
    if (!catalogBackend) {
        return finish(input, resultBase({
            result_text: 'Open Interpreter launcher is available, but the Copilot Provider Relay catalog does not currently expose the open-interpreter backend.',
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

    const forwardablePaths = normalizeForwardablePaths(input.paths);
    const submitArguments = {
        backend: BACKEND,
        prompt: withForwardingWarnings(input.prompt, [
            ...input.warnings,
            ...forwardablePaths.warnings,
        ]),
        resources: input.resources,
        origin: {
            type: 'semantic-copilot',
            surface: 'webchat',
            working_directory: input.workingDir,
            ...input.origin,
        },
        timeoutMs: input.timeoutMs,
    };
    if (forwardablePaths.paths.length) {
        submitArguments.paths = forwardablePaths.paths;
    }

    try {
        const payload = extractToolJson(await input.callAgentTool(RELAY_AGENT, SUBMIT_TOOL, submitArguments, {
            invocationToken: input.invocationToken,
            timeoutMs: input.timeoutMs + 330000,
            env: input.env,
        }));
        return finish(input, resultBase({
            ok: payload.ok !== undefined ? Boolean(payload.ok) : true,
            result_text: normalizeRelayAnswer(payload),
            persistence_hint: {
                ku_type: 'code_work',
                record_result: true,
                ttl_hint_seconds: null,
            },
            diagnostics: {
                providerAvailability: 'active',
                relayBackend: payload.backend || BACKEND,
                jobId: payload.jobId || null,
                sandboxOk: payload.sandbox_ok ?? null,
                backendOk: payload.backend_ok ?? null,
                providerAgent: providerAvailability.providerAgent,
            },
        }));
    } catch (error) {
        return finish(input, resultBase({
            result_text: `Open Interpreter task failed: ${error?.message || 'delegated task failed'}`,
            diagnostics: { providerAvailability: 'active', submitError: error?.message || String(error) },
        }));
    }
}
