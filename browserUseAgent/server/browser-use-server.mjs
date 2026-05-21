import http from 'node:http';
import { BrowserSessionManager } from './browser-session-manager.mjs';
import { loadProviderRegistry, providerAdapterContext } from './provider-registry.mjs';
import { mountViewerRoutes } from './viewer-routes.mjs';

const isContainerRuntime = Boolean(process.env.PLOINKY_CONTAINER_ID || process.env.PLOINKY_CONTAINER_NAME);
const HOST = process.env.BROWSER_USE_BIND_HOST
    || process.env.PLOINKY_AGENT_BIND_HOST
    || (isContainerRuntime ? '0.0.0.0' : '127.0.0.1');
const PORT = Number(process.env.BROWSER_USE_SERVICE_PORT || process.env.PORT) || 7000;
const MCP_HOST = process.env.BROWSER_USE_MCP_HOST || '127.0.0.1';
const MCP_PORT = Number(process.env.BROWSER_USE_MCP_PORT) || 7001;

const sessionManager = new BrowserSessionManager({
    dataDir: process.env.BROWSER_USE_DATA_DIR || '/data',
    headlessMode: process.env.BROWSER_HEADLESS_MODE || 'new',
    executablePath: process.env.BROWSER_EXECUTABLE_PATH || null,
});

sessionManager.start();

let providerRegistry = null;

async function initRegistry() {
    providerRegistry = await loadProviderRegistry();
    if (!providerRegistry || providerRegistry.size === 0) {
        throw new Error('provider registry loaded zero enabled providers');
    }
}

const handleViewer = mountViewerRoutes(sessionManager, () => providerRegistry);

function jsonResponse(res, status, body) {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
}

function readRequestBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > 128 * 1024) {
                reject(new Error('request body too large'));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}

function proxyAgentServer(req, res) {
    const headers = { ...req.headers, host: `${MCP_HOST}:${MCP_PORT}` };
    const upstream = http.request({
        hostname: MCP_HOST,
        port: MCP_PORT,
        method: req.method,
        path: req.url,
        headers,
    }, (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
        upstreamRes.pipe(res, { end: true });
    });

    upstream.on('error', (err) => {
        if (!res.headersSent) {
            res.writeHead(502, { 'content-type': 'application/json' });
        }
        res.end(JSON.stringify({ ok: false, error: 'agent server proxy failed', detail: String(err.message || err) }));
    });

    req.on('aborted', () => upstream.destroy());
    req.pipe(upstream, { end: true });
}

const BROWSER_START_FAILED_MESSAGE = 'Browser session could not be started. Close any existing browser-use viewer for this provider and try again.';

function parseAuthInfo(req) {
    const raw = req.headers['x-ploinky-auth-info'];
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
        return null;
    }
}

function userIdFromAuthInfo(authInfo) {
    if (!authInfo || typeof authInfo !== 'object') return '';
    if (authInfo.user && typeof authInfo.user === 'object') {
        return String(authInfo.user.id || authInfo.user.sub || '').trim();
    }
    return String(authInfo.userId || authInfo.sub || '').trim();
}

function requestUserId(req, body = {}) {
    return userIdFromAuthInfo(parseAuthInfo(req)) || String(body.userId || '').trim();
}

function interactiveSessionResponse(session, { sessionReused = false } = {}) {
    return {
        ok: true,
        state: session.state,
        requires_user_action: true,
        session_reused: Boolean(sessionReused),
        jobId: session.jobId,
        sessionId: session.sessionId,
        viewerUrl: session.viewerUrl,
        final_answer: '',
        natural_language_output: '',
        resources: [],
        sources: [],
    };
}

export async function runTask(params) {
    const prompt = String(params.prompt || '').trim();
    const requestedProvider = String(params.provider || '').trim().toLowerCase();
    const userId = String(params.userId || '').trim();
    const timeoutMs = params.timeoutMs;
    if (!prompt) {
        return { ok: false, error: 'prompt is required' };
    }
    if (!userId) {
        return { ok: false, error: 'authenticated user identity is required' };
    }

    const resolved = providerRegistry
        ? providerRegistry.resolveProvider(requestedProvider)
        : null;
    if (!resolved) {
        return { ok: false, error: `unsupported provider: ${requestedProvider || '(none)'}` };
    }
    const provider = resolved.id;
    const adapter = resolved.adapter;
    const providerContext = providerAdapterContext(resolved);

    return await sessionManager.withProfileLock(userId, provider, async () => {
        const reusableSession = sessionManager.getReusableSession(userId, provider);
        if (reusableSession) {
            if (reusableSession.state !== 'running') {
                sessionManager.updateSessionPrompt(reusableSession, prompt, { timeoutMs });
            }
            return interactiveSessionResponse(reusableSession, { sessionReused: true });
        }

        await sessionManager.waitForProfileRelease(userId, provider);

        const session = await sessionManager.createSession(userId, provider, { prompt, timeoutMs });
        await sessionManager.launchBrowser(session);

        if (session.state === 'failed') {
            return {
                ok: false,
                backend_ok: false,
                state: 'failed',
                error: 'browser_session_start_failed',
                jobId: session.jobId,
                sessionId: session.sessionId,
                viewerUrl: session.viewerUrl,
                final_answer: BROWSER_START_FAILED_MESSAGE,
                natural_language_output: BROWSER_START_FAILED_MESSAGE,
                resources: [],
                sources: [],
            };
        }

        await sessionManager.navigateTo(session, resolved.startUrl);
        const loginRequired = await sessionManager.detectLoginRequired(session, adapter, providerContext);

        if (loginRequired) {
            session.state = 'waiting_for_user';
            session.updatedAt = new Date().toISOString();
            return interactiveSessionResponse(session);
        }

        const result = await sessionManager.submitPrompt(session, prompt, adapter, providerContext);
        return {
            ok: result.ok,
            state: session.state,
            jobId: session.jobId,
            sessionId: session.sessionId,
            viewerUrl: session.viewerUrl,
            final_answer: result.final_answer || '',
            natural_language_output: result.final_answer || '',
            resources: [],
            sources: [],
        };
    });
}

export async function continueTask(jobId) {
    const session = sessionManager.getSessionByJobId(jobId);
    if (!session) {
        return { ok: false, error: 'job not found' };
    }
    if (!['waiting_for_user', 'running'].includes(session.state)) {
        return {
            ok: true,
            state: session.state,
            jobId: session.jobId,
            sessionId: session.sessionId,
            final_answer: '',
        };
    }

    const resolved = providerRegistry
        ? providerRegistry.getProvider(session.provider)
        : null;
    const adapter = resolved ? resolved.adapter : null;
    const result = await sessionManager.continueAfterUserReady(
        session,
        adapter,
        providerAdapterContext(resolved),
    );
    return {
        ok: result.ok,
        state: session.state,
        jobId: session.jobId,
        sessionId: session.sessionId,
        viewerUrl: session.viewerUrl,
        final_answer: result.final_answer || '',
        natural_language_output: result.final_answer || '',
        resources: [],
        sources: [],
    };
}

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    if (pathname === '/mcp' || pathname === '/health' || pathname === '/getTaskStatus') {
        proxyAgentServer(req, res);
        return;
    }

    if (pathname === '/status' && req.method === 'GET') {
        jsonResponse(res, 200, {
            ok: true,
            agent: 'browserUseAgent',
            activeSessions: sessionManager.activeSessionCount(),
            totalSessions: sessionManager.sessionCount(),
            chromiumAvailable: Boolean(process.env.BROWSER_EXECUTABLE_PATH),
            viewerTransport: 'http-sse',
            providers: providerRegistry ? providerRegistry.listProviders() : [],
        });
        return;
    }

    if (pathname === '/browser-use/run-task' && req.method === 'POST') {
        try {
            const body = JSON.parse(await readRequestBody(req));
            body.userId = requestUserId(req, body);
            if (!body.userId) {
                jsonResponse(res, 401, { ok: false, error: 'authenticated user identity is required' });
                return;
            }
            const result = await runTask(body);
            jsonResponse(res, 200, result);
        } catch (err) {
            jsonResponse(res, 400, { ok: false, error: err.message });
        }
        return;
    }

    if (pathname === '/browser-use/task-status' && req.method === 'GET') {
        const jobId = url.searchParams.get('jobId') || '';
        const session = sessionManager.getSessionByJobId(jobId);
        if (!session) {
            jsonResponse(res, 404, { ok: false, error: 'job not found' });
            return;
        }
        const userId = requestUserId(req, { userId: url.searchParams.get('userId') || '' });
        if (!userId || !sessionManager.isOwner(session, userId)) {
            jsonResponse(res, 403, { ok: false, error: 'not session owner' });
            return;
        }
        jsonResponse(res, 200, { ok: true, ...sessionManager.publicSessionView(session) });
        return;
    }

    if (pathname === '/browser-use/continue-task' && req.method === 'POST') {
        try {
            const body = JSON.parse(await readRequestBody(req));
            const session = sessionManager.getSessionByJobId(String(body.jobId || ''));
            const userId = requestUserId(req, body);
            if (!session) {
                jsonResponse(res, 404, { ok: false, error: 'job not found' });
                return;
            }
            if (!userId || !sessionManager.isOwner(session, userId)) {
                jsonResponse(res, 403, { ok: false, error: 'not session owner' });
                return;
            }
            const result = await continueTask(session.jobId);
            jsonResponse(res, 200, result);
        } catch (err) {
            jsonResponse(res, 400, { ok: false, error: err.message });
        }
        return;
    }

    if (pathname === '/browser-use/close-session' && req.method === 'POST') {
        try {
            const body = JSON.parse(await readRequestBody(req));
            const userId = requestUserId(req, body);
            if (body.sessionId) {
                const session = sessionManager.getSession(String(body.sessionId || ''));
                if (!session) {
                    jsonResponse(res, 404, { ok: false, error: 'session not found' });
                    return;
                }
                if (!userId || !sessionManager.isOwner(session, userId)) {
                    jsonResponse(res, 403, { ok: false, error: 'not session owner' });
                    return;
                }
                const result = await sessionManager.closeSession(body.sessionId);
                jsonResponse(res, 200, result);
            } else if (body.provider && body.clearProfile) {
                if (!userId) {
                    jsonResponse(res, 401, { ok: false, error: 'authenticated user identity is required' });
                    return;
                }
                const result = await sessionManager.clearProfile(userId, body.provider);
                jsonResponse(res, 200, result);
            } else {
                jsonResponse(res, 400, { ok: false, error: 'sessionId or provider+clearProfile required' });
            }
        } catch (err) {
            jsonResponse(res, 400, { ok: false, error: err.message });
        }
        return;
    }

    if (pathname.startsWith('/browser-use/')) {
        await handleViewer(req, res);
        return;
    }

    jsonResponse(res, 404, { ok: false, error: 'not found' });
});

initRegistry()
    .then(() => {
        server.listen(PORT, HOST, () => {
            const count = providerRegistry ? providerRegistry.size : 0;
            process.stdout.write(`browserUseAgent service listening on ${HOST}:${PORT}; proxying MCP to ${MCP_HOST}:${MCP_PORT}; ${count} provider(s) loaded\n`);
        });
    })
    .catch((err) => {
        process.stderr.write(`provider registry failed to load: ${err.message}\n`);
        process.exit(1);
    });

function shutdown() {
    sessionManager.stop();
    server.close();
    process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

export { sessionManager, providerRegistry };
