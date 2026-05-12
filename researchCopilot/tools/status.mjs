#!/usr/bin/env node
import { readEnvelope, writeOk, writeError } from './lib/envelope.mjs';
import { RESEARCH_BACKENDS } from './lib/backends.mjs';
import { callAgentTool } from './lib/mcp.mjs';

async function probeBackend(backend, invocationToken) {
    if (!backend.status_tool) {
        return { agent: backend.agent, reachable: false, reason: 'no status tool declared' };
    }
    if (!invocationToken) {
        return { agent: backend.agent, reachable: false, reason: 'missing delegated invocation token' };
    }
    try {
        const response = await callAgentTool(backend.agent, backend.status_tool, {}, { timeoutMs: 4000, invocationToken });
        const result = response && response.result ? response.result : response;
        return { agent: backend.agent, reachable: true, status: result };
    } catch (error) {
        return { agent: backend.agent, reachable: false, reason: error && error.message ? error.message : 'probe failed' };
    }
}

async function main() {
    try {
        const envelope = await readEnvelope();
        const invocationToken = envelope.metadata && typeof envelope.metadata.invocationToken === 'string'
            ? envelope.metadata.invocationToken
            : '';
        const backends = await Promise.all(RESEARCH_BACKENDS.map((backend) => probeBackend(backend, invocationToken)));
        writeOk({ backends });
    } catch (error) {
        writeError(error && error.message ? error.message : 'research_copilot_status failed');
    }
}

main();
