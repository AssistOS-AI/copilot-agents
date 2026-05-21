import { URL } from 'node:url';
import { providerAdapterContext } from './provider-registry.mjs';

function parseSessionId(urlPath) {
    const match = urlPath.match(/^\/browser-use\/sessions\/(sess_[A-Za-z0-9]+)/);
    return match ? match[1] : null;
}

function jsonResponse(res, status, body) {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
}

function parseAuthInfo(req) {
    const raw = req.headers['x-ploinky-auth-info'];
    if (!raw) return null;
    try {
        const info = JSON.parse(raw);
        return info && typeof info === 'object' ? info : null;
    } catch {
        return null;
    }
}

function getOwnerUserId(req) {
    const auth = parseAuthInfo(req);
    if (auth && auth.user && typeof auth.user === 'object') {
        return String(auth.user.id || auth.user.sub || '').trim() || null;
    }
    if (auth && auth.userId) return String(auth.userId);
    if (auth && auth.sub) return String(auth.sub);
    return null;
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > 64 * 1024) {
                reject(new Error('request body too large'));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}

const VIEWER_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Browser Use Viewer</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #1a1a2e; color: #eee; height: 100vh; display: flex; flex-direction: column; }
.header { padding: 12px 20px; background: #16213e; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #0f3460; }
.header h1 { font-size: 16px; font-weight: 500; }
.status { padding: 4px 12px; border-radius: 12px; font-size: 13px; font-weight: 500; }
.status.waiting { background: #e2a03f; color: #1a1a2e; }
.status.running { background: #3498db; color: #fff; }
.status.completed { background: #2ecc71; color: #1a1a2e; }
.status.failed { background: #e74c3c; color: #fff; }
.status.starting, .status.ready { background: #95a5a6; color: #1a1a2e; }
.viewer-area { flex: 1; position: relative; overflow: hidden; display: flex; align-items: center; justify-content: center; }
.viewer-area img { max-width: 100%; max-height: 100%; cursor: crosshair; }
.controls { padding: 12px 20px; background: #16213e; display: flex; gap: 12px; align-items: center; border-top: 1px solid #0f3460; }
.controls button { padding: 8px 20px; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 500; }
.btn-ready { background: #2ecc71; color: #1a1a2e; }
.btn-ready:hover { background: #27ae60; }
.btn-close { background: #e74c3c; color: #fff; }
.btn-close:hover { background: #c0392b; }
.text-input { flex: 1; padding: 8px 12px; border: 1px solid #0f3460; border-radius: 6px; background: #1a1a2e; color: #eee; font-size: 14px; }
.info { font-size: 13px; color: #95a5a6; }
</style>
</head>
<body>
<div class="header">
    <h1>Browser Use Viewer</h1>
    <span class="status starting" id="status">starting</span>
</div>
<div class="viewer-area" id="viewer">
    <p class="info" id="placeholder">Waiting for browser session...</p>
    <img id="screenshot" style="display:none" alt="Browser screenshot">
</div>
<div class="controls">
    <button class="btn-ready" id="readyBtn" style="display:none">Login Complete - Continue</button>
    <input class="text-input" id="textInput" placeholder="Type text and press Enter to send to browser" style="display:none">
    <button class="btn-close" id="closeBtn">Close Session</button>
</div>
<script>
(function() {
    const sessionId = location.pathname.split('/sessions/')[1]?.split('/')[0] || '';
    const basePath = location.pathname.split('/sessions/')[0] + '/sessions/' + sessionId;
    const statusEl = document.getElementById('status');
    const screenshot = document.getElementById('screenshot');
    const placeholder = document.getElementById('placeholder');
    const readyBtn = document.getElementById('readyBtn');
    const textInput = document.getElementById('textInput');
    const closeBtn = document.getElementById('closeBtn');
    const viewer = document.getElementById('viewer');

    function updateStatus(state) {
        statusEl.textContent = state;
        statusEl.className = 'status ' + (state === 'waiting_for_user' ? 'waiting' : state);
        readyBtn.style.display = state === 'waiting_for_user' ? '' : 'none';
        textInput.style.display = ['waiting_for_user', 'running', 'ready'].includes(state) ? '' : 'none';
    }

    const evtSource = new EventSource(basePath + '/events');
    evtSource.onmessage = function(e) {
        try {
            const data = JSON.parse(e.data);
            if (data.state) updateStatus(data.state);
            if (data.screenshot) {
                screenshot.src = 'data:image/jpeg;base64,' + data.screenshot;
                screenshot.style.display = '';
                placeholder.style.display = 'none';
            }
            if (data.pageUrl) document.title = 'Browser Use - ' + data.pageUrl;
            if (['completed','failed','closed'].includes(data.state)) {
                evtSource.close();
                if (data.state === 'completed') placeholder.textContent = 'Task completed.';
                else if (data.state === 'failed') placeholder.textContent = 'Task failed: ' + (data.error || '');
                else placeholder.textContent = 'Session closed.';
                placeholder.style.display = '';
            }
        } catch {}
    };
    evtSource.onerror = function() { statusEl.textContent = 'disconnected'; };

    screenshot.addEventListener('click', function(e) {
        const rect = screenshot.getBoundingClientRect();
        const scaleX = screenshot.naturalWidth / rect.width;
        const scaleY = screenshot.naturalHeight / rect.height;
        const x = Math.round((e.clientX - rect.left) * scaleX);
        const y = Math.round((e.clientY - rect.top) * scaleY);
        fetch(basePath + '/input', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ type: 'click', x: x, y: y }),
        });
    });

    textInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && textInput.value) {
            fetch(basePath + '/input', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ type: 'type', text: textInput.value }),
            });
            textInput.value = '';
        }
    });

    readyBtn.addEventListener('click', function() {
        fetch(basePath + '/user-ready', { method: 'POST' });
    });

    closeBtn.addEventListener('click', function() {
        fetch(basePath + '/close', { method: 'POST' }).then(function() {
            updateStatus('closed');
            evtSource.close();
        });
    });
})();
</script>
</body>
</html>`;

export function mountViewerRoutes(sessionManager, getRegistry) {
    const sseClients = new Map();

    function broadcastToSession(sessionId, data) {
        const clients = sseClients.get(sessionId);
        if (!clients) return;
        const payload = `data: ${JSON.stringify(data)}\n\n`;
        for (const res of clients) {
            try { res.write(payload); } catch {}
        }
    }

    function startScreenshotLoop(sessionId) {
        const interval = setInterval(async () => {
            const session = sessionManager.getSession(sessionId);
            if (!session || !sseClients.has(sessionId) || sseClients.get(sessionId).size === 0) {
                clearInterval(interval);
                return;
            }
            if (['completed', 'failed', 'closed'].includes(session.state)) {
                broadcastToSession(sessionId, sessionManager.publicSessionView(session));
                clearInterval(interval);
                return;
            }
            const screenshot = await sessionManager.takeScreenshot(session);
            const data = { ...sessionManager.publicSessionView(session) };
            if (screenshot) {
                data.screenshot = screenshot.toString('base64');
            }
            broadcastToSession(sessionId, data);
        }, 1500);
        interval.unref();
    }

    return async function handleViewerRequest(req, res) {
        const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        const pathname = url.pathname;

        const sessionId = parseSessionId(pathname);
        if (!sessionId) {
            jsonResponse(res, 404, { ok: false, error: 'session id required' });
            return;
        }

        const session = sessionManager.getSession(sessionId);
        if (!session) {
            jsonResponse(res, 404, { ok: false, error: 'session not found' });
            return;
        }

        const userId = getOwnerUserId(req);
        if (!userId) {
            jsonResponse(res, 401, { ok: false, error: 'authenticated user identity is required' });
            return;
        }
        if (!sessionManager.isOwner(session, userId)) {
            jsonResponse(res, 403, { ok: false, error: 'not session owner' });
            return;
        }

        const subPath = pathname.slice(`/browser-use/sessions/${sessionId}`.length);

        if (req.method === 'GET' && (subPath === '' || subPath === '/')) {
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
            res.end(VIEWER_HTML);
            return;
        }

        if (req.method === 'GET' && subPath === '/events') {
            res.writeHead(200, {
                'content-type': 'text/event-stream',
                'cache-control': 'no-cache',
                'connection': 'keep-alive',
                'x-accel-buffering': 'no',
            });
            res.write(`data: ${JSON.stringify(sessionManager.publicSessionView(session))}\n\n`);

            if (!sseClients.has(sessionId)) {
                sseClients.set(sessionId, new Set());
                startScreenshotLoop(sessionId);
            }
            sseClients.get(sessionId).add(res);
            req.on('close', () => {
                const clients = sseClients.get(sessionId);
                if (clients) {
                    clients.delete(res);
                    if (clients.size === 0) sseClients.delete(sessionId);
                }
            });
            return;
        }

        if (req.method === 'POST' && subPath === '/input') {
            try {
                const body = JSON.parse((await readBody(req)).toString('utf8'));
                const result = await sessionManager.sendInput(session, body);
                jsonResponse(res, result.ok ? 200 : 400, result);
            } catch (err) {
                jsonResponse(res, 400, { ok: false, error: err.message });
            }
            return;
        }

        if (req.method === 'POST' && subPath === '/user-ready') {
            const registry = typeof getRegistry === 'function' ? getRegistry() : null;
            const resolved = registry ? registry.getProvider(session.provider) : null;
            const adapter = resolved ? resolved.adapter : null;
            const result = sessionManager.startContinuation(
                session,
                adapter,
                providerAdapterContext(resolved),
            );
            if (result.ok) {
                broadcastToSession(sessionId, sessionManager.publicSessionView(session));
            }
            jsonResponse(res, result.ok ? 200 : 400, result);
            return;
        }

        if (req.method === 'POST' && subPath === '/close') {
            const result = await sessionManager.closeSession(sessionId);
            broadcastToSession(sessionId, { ...sessionManager.publicSessionView(session), state: 'closed' });
            jsonResponse(res, 200, result);
            return;
        }

        if (req.method === 'GET' && subPath === '/status') {
            jsonResponse(res, 200, { ok: true, ...sessionManager.publicSessionView(session) });
            return;
        }

        jsonResponse(res, 404, { ok: false, error: 'not found' });
    };
}
