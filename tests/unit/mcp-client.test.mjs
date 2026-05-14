import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { callAgentTool } from '../../researchRelay/tools/lib/mcp.mjs';

async function withServer(handler, fn) {
    const server = http.createServer(handler);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const original = process.env.PLOINKY_ROUTER_URL;
    process.env.PLOINKY_ROUTER_URL = `http://127.0.0.1:${address.port}`;
    try {
        await fn();
    } finally {
        if (original === undefined) {
            delete process.env.PLOINKY_ROUTER_URL;
        } else {
            process.env.PLOINKY_ROUTER_URL = original;
        }
        await new Promise((resolve) => server.close(resolve));
    }
}

test('callAgentTool forwards delegated invocation JWT through Ploinky caller header', async () => {
    await withServer((req, res) => {
        assert.equal(req.headers['x-ploinky-caller-jwt'], 'caller-token');
        assert.equal(req.url, '/mcps/openInterpreterAgent/mcp');
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { ok: true } }));
    }, async () => {
        const response = await callAgentTool(
            'openInterpreterAgent',
            'oi_status',
            {},
            { invocationToken: 'caller-token' }
        );
        assert.deepEqual(response.result, { ok: true });
    });
});

test('callAgentTool rejects JSON-RPC error responses', async () => {
    await withServer((_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            error: { code: -32000, message: 'Missing or invalid MCP session' }
        }));
    }, async () => {
        await assert.rejects(
            () => callAgentTool('openInterpreterAgent', 'oi_status', {}, { invocationToken: 'caller-token' }),
            /Missing or invalid MCP session/
        );
    });
});
