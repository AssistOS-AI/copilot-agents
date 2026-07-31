import { Buffer } from 'node:buffer';
import http from 'node:http';

function unwrapToolResult(result) {
    const content = Array.isArray(result?.content) ? result.content : [];
    if (content.length !== 1 || content[0]?.type !== 'text' || typeof content[0].text !== 'string') {
        return result;
    }
    try {
        return JSON.parse(content[0].text);
    } catch {
        return result;
    }
}

export async function createAgentClient(agent) {
    return {
        async callTool(toolName, input, options = {}) {
            const base = new URL(process.env.PLOINKY_TEST_ROUTER_URL);
            const payload = Buffer.from(JSON.stringify({
                jsonrpc: '2.0',
                id: 'agent-mcp-test',
                method: 'tools/call',
                params: { name: toolName, arguments: input || {} },
            }), 'utf8');
            const delegationToken = options.userDelegationToken || '';
            return await new Promise((resolve, reject) => {
                const request = http.request({
                    hostname: base.hostname,
                    port: base.port,
                    path: `/${encodeURIComponent(agent)}/mcp`,
                    method: 'POST',
                    headers: {
                        authorization: 'Bearer mock-agent-assertion',
                        'content-type': 'application/json',
                        'content-length': payload.length,
                        ...(delegationToken ? { 'x-ploinky-user-delegation': delegationToken } : {}),
                    },
                }, (response) => {
                    const chunks = [];
                    response.on('data', (chunk) => chunks.push(chunk));
                    response.on('end', () => {
                        try {
                            const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                            if (response.statusCode >= 400 || parsed?.error) {
                                reject(new Error(parsed?.error?.message || `router responded ${response.statusCode}`));
                                return;
                            }
                            resolve(unwrapToolResult(parsed.result));
                        } catch (error) {
                            reject(error);
                        }
                    });
                });
                request.on('error', reject);
                request.end(payload);
            });
        },
        async close() {},
    };
}
