import http from 'node:http';

const DEFAULT_MAX_REQUEST_BYTES = 900 * 1024;
const DEFAULT_UPSTREAM_TIMEOUT_MS = 70000;

function stringValue(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeChatCompletionsURL(url) {
    const trimmed = stringValue(url).replace(/\/+$/, '');
    if (!trimmed) return '';
    if (trimmed.endsWith('/chat/completions')) return trimmed;
    if (trimmed.endsWith('/v1')) return `${trimmed}/chat/completions`;
    return `${trimmed}/v1/chat/completions`;
}

function writeJson(res, status, body) {
    res.writeHead(status, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
    });
    res.end(JSON.stringify(body));
}

function readRequestBody(req, maxBytes) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let total = 0;
        req.on('data', (chunk) => {
            total += chunk.length;
            if (total > maxBytes) {
                reject(Object.assign(new Error('request body too large'), { status: 413 }));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}

function copyResponseHeaders(upstreamResponse) {
    const headers = {
        'cache-control': 'no-store',
    };
    const contentType = upstreamResponse.headers.get('content-type');
    if (contentType) headers['content-type'] = contentType;
    return headers;
}

async function writeUpstreamResponse(res, upstreamResponse) {
    res.writeHead(upstreamResponse.status, copyResponseHeaders(upstreamResponse));
    if (!upstreamResponse.body) {
        res.end(await upstreamResponse.text());
        return;
    }
    try {
        for await (const chunk of upstreamResponse.body) {
            res.write(chunk);
        }
        res.end();
    } catch (error) {
        if (!res.destroyed) res.destroy(error);
    }
}

export async function startOpenAICompatibleBroker({
    upstreamUrl,
    upstreamApiKey,
    upstreamModel,
    sandboxApiKey,
    maxRequestBytes = DEFAULT_MAX_REQUEST_BYTES,
    upstreamTimeoutMs = DEFAULT_UPSTREAM_TIMEOUT_MS,
    fetchImpl = globalThis.fetch,
} = {}) {
    const targetUrl = normalizeChatCompletionsURL(upstreamUrl);
    const providerKey = stringValue(upstreamApiKey);
    const model = stringValue(upstreamModel);
    const sandboxToken = stringValue(sandboxApiKey);
    if (!targetUrl) throw new Error('broker requires an upstream chat completions URL');
    if (!providerKey) throw new Error('broker requires an upstream API key');
    if (!model) throw new Error('broker requires an upstream model');
    if (!sandboxToken) throw new Error('broker requires a sandbox API key');
    if (typeof fetchImpl !== 'function') throw new Error('broker requires fetch');

    const sockets = new Set();
    const server = http.createServer(async (req, res) => {
        const requestUrl = new URL(req.url || '/', 'http://127.0.0.1');
        if (requestUrl.pathname !== '/v1/chat/completions') {
            writeJson(res, 404, { error: { message: 'route not found' } });
            return;
        }
        if (req.method !== 'POST') {
            writeJson(res, 405, { error: { message: 'method not allowed' } });
            return;
        }
        if (req.headers.authorization !== `Bearer ${sandboxToken}`) {
            writeJson(res, 401, { error: { message: 'unauthorized' } });
            return;
        }

        let bodyText;
        try {
            bodyText = await readRequestBody(req, maxRequestBytes);
        } catch (error) {
            writeJson(res, error?.status || 400, { error: { message: error?.message || 'invalid request body' } });
            return;
        }

        let payload;
        try {
            payload = bodyText ? JSON.parse(bodyText) : {};
        } catch (_) {
            writeJson(res, 400, { error: { message: 'request body must be JSON' } });
            return;
        }
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
            writeJson(res, 400, { error: { message: 'request body must be an object' } });
            return;
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), upstreamTimeoutMs);
        try {
            const upstreamResponse = await fetchImpl(targetUrl, {
                method: 'POST',
                headers: {
                    authorization: `Bearer ${providerKey}`,
                    'content-type': 'application/json',
                    accept: req.headers.accept || 'application/json',
                },
                body: JSON.stringify({
                    ...payload,
                    model,
                }),
                signal: controller.signal,
            });
            clearTimeout(timeout);
            await writeUpstreamResponse(res, upstreamResponse);
        } catch (error) {
            clearTimeout(timeout);
            if (res.headersSent) {
                if (!res.destroyed) res.destroy(error);
                return;
            }
            const timedOut = error?.name === 'AbortError';
            writeJson(res, timedOut ? 504 : 502, {
                error: { message: timedOut ? 'upstream request timed out' : 'upstream request failed' },
            });
        }
    });

    server.on('connection', (socket) => {
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
    });

    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            server.off('error', reject);
            resolve();
        });
    });
    server.unref();
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : null;
    if (!port) {
        throw new Error('broker did not bind a local port');
    }

    let closed = false;
    async function close() {
        if (closed) return;
        closed = true;
        for (const socket of sockets) {
            socket.destroy();
        }
        await new Promise((resolve) => server.close(resolve));
    }

    return {
        apiBase: `http://127.0.0.1:${port}/v1`,
        close,
    };
}

export function __privateForTests() {
    return { normalizeChatCompletionsURL };
}
