import test from 'node:test';
import assert from 'node:assert/strict';

import {
    BACKEND,
    LIST_TOOL,
    PROVIDER_AGENT,
    PROVIDER_STATUS_TOOL,
    RELAY_AGENT,
    SUBMIT_TOOL,
    action,
} from '../../achilles-skills/launch-web-search/src/index.mjs';

function jsonResponse(payload) {
    return {
        result: {
            content: [{ type: 'text', text: JSON.stringify(payload) }],
        },
    };
}

test('launcher metadata targets researchRelay and web-search backend', () => {
    assert.equal(BACKEND, 'web-search');
    assert.equal(RELAY_AGENT, 'researchRelay');
    assert.equal(PROVIDER_AGENT, 'webSearchAgent');
    assert.equal(LIST_TOOL, 'research_relay_list_backends');
    assert.equal(SUBMIT_TOOL, 'research_task_submit');
    assert.equal(PROVIDER_STATUS_TOOL, 'web_search_status');
});

test('action refuses to dispatch without a router invocation token', async () => {
    const calls = [];
    const result = await action({
        prompt: 'search for Node.js release',
        callAgentTool: (...args) => {
            calls.push(args);
            throw new Error('unexpected call');
        },
    });
    assert.equal(result.ok, false);
    assert.equal(result.cacheable, false);
    assert.equal(result.diagnostics.missingInvocationToken, true);
    assert.equal(calls.length, 0);
});

test('@web-search is ordinary chat text and never calls research_task_submit', async () => {
    const calls = [];
    const result = await action({
        prompt: '@web-search latest news',
        context: { invocationToken: 'caller-token' },
        callAgentTool: (...args) => {
            calls.push(args);
            throw new Error('unexpected call');
        },
    });
    assert.equal(result.ok, false);
    assert.equal(result.cacheable, false);
    assert.equal(result.diagnostics.deprecatedToken, true);
    assert.match(result.result_text, /ordinary chat text/);
    assert.equal(calls.length, 0);
});

test('@search alone is ordinary chat text', async () => {
    const calls = [];
    const result = await action({
        prompt: '@search something',
        context: { invocationToken: 'caller-token' },
        callAgentTool: (...args) => {
            calls.push(args);
            throw new Error('unexpected call');
        },
    });
    assert.equal(result.ok, false);
    assert.equal(result.diagnostics.deprecatedToken, true);
    assert.equal(calls.length, 0);
});

test('action reports missing web-search backend without Ploinky enable guidance', async () => {
    const result = await action({
        prompt: 'search for latest news',
        context: { invocationToken: 'caller-token' },
        callAgentTool: async () => jsonResponse({ backends: [] }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.cacheable, false);
    assert.equal(result.diagnostics.missingBackend, BACKEND);
    assert.match(result.result_text, /launcher is available/);
    assert.doesNotMatch(result.result_text, /ploinky enable/i);
});

test('action returns unavailable when provider status fails', async () => {
    const calls = [];
    const result = await action({
        prompt: 'search for latest news',
        context: { invocationToken: 'caller-token' },
        callAgentTool: async (...args) => {
            calls.push(args);
            const [, toolName] = args;
            if (toolName === LIST_TOOL) {
                return jsonResponse({
                    backends: [{ id: BACKEND, tags: ['web-search'], provider: { agent: PROVIDER_AGENT } }],
                });
            }
            if (toolName === PROVIDER_STATUS_TOOL) {
                throw new Error('route not found');
            }
            throw new Error('submit should not be called');
        },
    });
    assert.equal(result.ok, false);
    assert.equal(result.cacheable, false);
    assert.equal(result.diagnostics.providerAvailability, 'not_deployed');
    assert.match(result.result_text, /provider agent webSearchAgent is not reachable/);
    assert.deepEqual(calls.map((c) => [c[0], c[1]]), [
        [RELAY_AGENT, LIST_TOOL],
        [PROVIDER_AGENT, PROVIDER_STATUS_TOOL],
    ]);
});

test('successful submit returns cacheable=true and correct persistence_hint', async () => {
    const calls = [];
    const result = await action({
        prompt: 'latest Node.js release date',
        context: { invocationToken: 'caller-token', workingDir: '/workspace' },
        callAgentTool: async (...args) => {
            calls.push(args);
            const [, toolName] = args;
            if (toolName === LIST_TOOL) {
                return jsonResponse({
                    backends: [{ id: BACKEND, tags: ['web-search'], provider: { agent: PROVIDER_AGENT } }],
                });
            }
            if (toolName === PROVIDER_STATUS_TOOL) {
                return jsonResponse({ agent: PROVIDER_AGENT, ok: true });
            }
            return jsonResponse({
                ok: true,
                backend_ok: true,
                cacheable: true,
                ttl_hint_seconds: 86400,
                final_answer: 'Node.js v22.0 was released on April 24, 2024.',
                sources: [{ title: 'Node.js Blog', url: 'https://nodejs.org/en/blog' }],
            });
        },
    });

    assert.equal(result.ok, true);
    assert.equal(result.cacheable, true);
    assert.equal(result.backend, 'web-search');
    assert.equal(result.result_text, 'Node.js v22.0 was released on April 24, 2024.');
    assert.equal(result.persistence_hint.ku_type, 'agent.result.web-search');
    assert.equal(result.persistence_hint.record_result, true);
    assert.equal(result.persistence_hint.ttl_hint_seconds, 86400);
    assert.equal(result.diagnostics.providerAvailability, 'active');
    assert.equal(result.diagnostics.providerAgent, PROVIDER_AGENT);
    assert.equal(calls.length, 3);
    assert.deepEqual(calls.map((c) => [c[0], c[1]]), [
        [RELAY_AGENT, LIST_TOOL],
        [PROVIDER_AGENT, PROVIDER_STATUS_TOOL],
        [RELAY_AGENT, SUBMIT_TOOL],
    ]);
    assert.equal(calls[2][2].backend, BACKEND);
    assert.equal(calls[2][2].prompt, 'latest Node.js release date');
    assert.equal(calls[2][2].origin.type, 'semantic-copilot');
});
