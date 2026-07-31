import test from 'node:test';
import assert from 'node:assert/strict';

import {
    callAgentTool,
    extractToolJson,
} from '../../copilotProviderRelay/tools/lib/mcp.mjs';

test('callAgentTool delegates through AgentMcpClient after descriptor verification', async () => {
    const events = [];
    const options = {
        createAgentClient: async (agent) => {
            events.push(`descriptor:${agent}`);
            return {
                async callTool(toolName, input, callOptions) {
                    events.push(`agent-secret:${toolName}`);
                    const delegation = callOptions.userDelegationToken;
                    events.push(`delegation:${delegation}`);
                    events.push('socket');
                    assert.deepEqual(input, { probe: true });
                    return { ok: true };
                },
                async close() {
                    events.push('close');
                },
            };
        },
    };
    Object.defineProperty(options, 'invocationToken', {
        enumerable: true,
        get() {
            events.push('invocation-token-read');
            return 'caller-token';
        },
    });

    const response = await callAgentTool(
        'openInterpreterAgent',
        'oi_status',
        { probe: true },
        options,
    );

    assert.deepEqual(response.result, { ok: true });
    assert.deepEqual(events, [
        'descriptor:openInterpreterAgent',
        'agent-secret:oi_status',
        'invocation-token-read',
        'delegation:caller-token',
        'socket',
        'close',
    ]);
});

test('descriptor rejection prevents invocation-token access and tool calls', async () => {
    const events = [];
    const options = {
        async createAgentClient() {
            events.push('descriptor');
            throw new Error('PLOINKY_ROUTER_DESCRIPTOR_SIGNATURE');
        },
    };
    Object.defineProperty(options, 'invocationToken', {
        get() {
            events.push('invocation-token-read');
            return 'must-not-be-read';
        },
    });

    await assert.rejects(
        () => callAgentTool('openInterpreterAgent', 'oi_status', {}, options),
        /PLOINKY_ROUTER_DESCRIPTOR_SIGNATURE/,
    );
    assert.deepEqual(events, ['descriptor']);
});

test('extractToolJson accepts AgentMcpClient object results', () => {
    assert.deepEqual(
        extractToolJson({ result: { ok: true, status: 'ready' } }),
        { ok: true, status: 'ready' },
    );
});
