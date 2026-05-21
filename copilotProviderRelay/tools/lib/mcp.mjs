// Minimal Ploinky MCP client for copilotProviderRelay tools.
// Routes calls through the workspace router rather than direct agent ports,
// preserving the secure-wire contract in DS002.

import { Buffer } from 'node:buffer';
import http from 'node:http';
import https from 'node:https';

function resolveRouterUrl() {
    const explicit = process.env.PLOINKY_ROUTER_URL;
    if (explicit) {
        return explicit.replace(/\/$/, '');
    }
    const host = process.env.PLOINKY_ROUTER_HOST || '127.0.0.1';
    const port = process.env.PLOINKY_ROUTER_PORT || '8080';
    return `http://${host}:${port}`;
}

export async function callAgentTool(agent, toolName, input = {}, { timeoutMs = 5000, invocationToken = '' } = {}) {
    const base = resolveRouterUrl();
    const url = new URL(`/mcps/${encodeURIComponent(agent)}/mcp`, base);
    const payload = JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'tools/call',
        params: { name: toolName, arguments: input || {} },
    });

    const headers = {
        'content-type': 'application/json',
        accept: 'application/json',
        'content-length': Buffer.byteLength(payload).toString(),
    };
    const jwt = invocationToken || process.env.PLOINKY_INVOCATION_JWT;
    if (jwt) {
        headers['x-ploinky-caller-jwt'] = jwt;
    }

    const transport = url.protocol === 'https:' ? https : http;
    return await new Promise((resolve, reject) => {
        const req = transport.request({
            method: 'POST',
            protocol: url.protocol,
            hostname: url.hostname,
            port: url.port || (url.protocol === 'https:' ? 443 : 80),
            path: `${url.pathname}${url.search}`,
            headers,
            timeout: timeoutMs,
        }, (res) => {
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => {
                const text = Buffer.concat(chunks).toString('utf8');
                if (!res.statusCode || res.statusCode >= 400) {
                    reject(new Error(`router responded ${res.statusCode}`));
                    return;
                }
                try {
                    const parsed = text ? JSON.parse(text) : {};
                    if (parsed && parsed.error) {
                        const message = parsed.error.message || parsed.error.detail || parsed.error.code || 'MCP tool call failed';
                        reject(new Error(String(message)));
                        return;
                    }
                    resolve(parsed);
                } catch (err) {
                    reject(new Error(`invalid MCP response: ${err.message}`));
                }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy(new Error('router request timed out'));
        });
        req.write(payload);
        req.end();
    });
}

export function extractToolText(response) {
    const result = response && response.result ? response.result : response;
    if (typeof result === 'string') {
        return result;
    }
    if (result && Array.isArray(result.content)) {
        return result.content
            .filter((entry) => entry && entry.type === 'text' && typeof entry.text === 'string')
            .map((entry) => entry.text)
            .join('\n');
    }
    if (result && typeof result.text === 'string') {
        return result.text;
    }
    return '';
}

export function extractToolJson(response) {
    const text = extractToolText(response).trim();
    if (!text) {
        return {};
    }
    try {
        return JSON.parse(text);
    } catch (error) {
        throw new Error(`invalid JSON tool response: ${error.message}`);
    }
}
