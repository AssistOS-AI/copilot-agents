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
} from '../../achilles-skills/launch-open-interpreter/src/index.mjs';

function jsonResponse(payload) {
    return {
        result: {
            content: [{ type: 'text', text: JSON.stringify(payload) }]
        }
    };
}

test('launcher metadata targets copilotProviderRelay and Open Interpreter backend', () => {
    assert.equal(BACKEND, 'open-interpreter');
    assert.equal(RELAY_AGENT, 'copilotProviderRelay');
    assert.equal(PROVIDER_AGENT, 'openInterpreterAgent');
    assert.equal(LIST_TOOL, 'copilot_provider_list_backends');
    assert.equal(SUBMIT_TOOL, 'copilot_provider_task_submit');
    assert.equal(PROVIDER_STATUS_TOOL, 'oi_status');
});

test('action refuses to dispatch without a router invocation token', async () => {
    const calls = [];
    const result = await action({
        prompt: 'run this code',
        callAgentTool: (...args) => {
            calls.push(args);
            throw new Error('unexpected call');
        }
    });
    assert.equal(result.ok, false);
    assert.equal(result.cacheable, false);
    assert.equal(result.diagnostics.missingInvocationToken, true);
    assert.equal(calls.length, 0);
});

test('@open-interpreter is ordinary chat text and never calls copilot_provider_task_submit', async () => {
    const calls = [];
    const result = await action({
        prompt: '@open-interpreter list primes',
        context: { invocationToken: 'caller-token' },
        callAgentTool: (...args) => {
            calls.push(args);
            throw new Error('unexpected call');
        }
    });
    assert.equal(result.ok, false);
    assert.equal(result.cacheable, false);
    assert.equal(result.diagnostics.deprecatedToken, true);
    assert.match(result.result_text, /ordinary chat text/);
    assert.equal(calls.length, 0);
});

test('action dispatches through copilotProviderRelay with invocation token and resources', async () => {
    const calls = [];
    const result = await action({
        prompt: 'run a quick diagnostic',
        context: {
            invocationToken: 'caller-token',
            workingDir: '/workspace/project',
            webchatResources: [{ name: 'notes.md', content: 'hello' }],
            webchatPaths: [
                { path: 'docs', type: 'directory', label: 'Docs' },
                { path: 'src/diagnostic.mjs', type: 'file', label: 'Diagnostic' },
            ],
            webchatOrigin: { tabId: 'tab-1' },
            webchatResourceWarnings: ['missing reference']
        },
        callAgentTool: async (...args) => {
            calls.push(args);
            const [, toolName] = args;
            if (toolName === LIST_TOOL) {
                return jsonResponse({ backends: [{ id: BACKEND, provider: { agent: PROVIDER_AGENT } }] });
            }
            if (toolName === PROVIDER_STATUS_TOOL) {
                return jsonResponse({ agent: PROVIDER_AGENT, status: 'ok' });
            }
            return jsonResponse({ ok: true, backend: BACKEND, final_answer: 'diagnostic complete', jobId: 'job-1' });
        }
    });

    assert.equal(result.ok, true);
    assert.equal(result.cacheable, false);
    assert.equal(result.result_text, 'diagnostic complete');
    assert.equal(calls.length, 3);
    assert.deepEqual(calls.map((call) => [call[0], call[1]]), [
        [RELAY_AGENT, LIST_TOOL],
        [PROVIDER_AGENT, PROVIDER_STATUS_TOOL],
        [RELAY_AGENT, SUBMIT_TOOL],
    ]);
    assert.equal(calls[0][3].invocationToken, 'caller-token');
    assert.equal(calls[1][3].invocationToken, 'caller-token');
    assert.equal(calls[2][3].invocationToken, 'caller-token');
    const submitArguments = calls[2][2];
    assert.equal(submitArguments.backend, BACKEND);
    assert.match(submitArguments.prompt, /run a quick diagnostic/);
    assert.match(submitArguments.prompt, /Reference forwarding notes:/);
    assert.match(submitArguments.prompt, /Workspace reference "Docs" is a directory path/);
    assert.deepEqual(submitArguments.resources, [{ name: 'notes.md', content: 'hello' }]);
    assert.deepEqual(submitArguments.paths, ['src/diagnostic.mjs']);
    assert.equal(submitArguments.origin.tabId, 'tab-1');
    assert.equal(submitArguments.origin.type, 'semantic-copilot');
    assert.equal(result.diagnostics.providerAgent, PROVIDER_AGENT);
});

test('action reports missing backend without Ploinky enable guidance', async () => {
    const result = await action({
        prompt: 'run a quick diagnostic',
        context: { invocationToken: 'caller-token' },
        callAgentTool: async () => jsonResponse({ backends: [] })
    });
    assert.equal(result.ok, false);
    assert.equal(result.cacheable, false);
    assert.equal(result.diagnostics.missingBackend, BACKEND);
    assert.match(result.result_text, /launcher is available/);
    assert.doesNotMatch(result.result_text, /ploinky enable/i);
});

test('action returns unavailable when Open Interpreter provider route is missing', async () => {
    const calls = [];
    const result = await action({
        prompt: 'run a quick diagnostic',
        context: { invocationToken: 'caller-token' },
        callAgentTool: async (...args) => {
            calls.push(args);
            const [, toolName] = args;
            if (toolName === LIST_TOOL) {
                return jsonResponse({ backends: [{ id: BACKEND, provider: { agent: PROVIDER_AGENT } }] });
            }
            if (toolName === PROVIDER_STATUS_TOOL) {
                throw new Error('route not found');
            }
            throw new Error('submit should not be called');
        }
    });

    assert.equal(result.ok, false);
    assert.equal(result.cacheable, false);
    assert.equal(result.diagnostics.providerAvailability, 'not_deployed');
    assert.match(result.result_text, /provider agent openInterpreterAgent is not reachable/);
    assert.deepEqual(calls.map((call) => [call[0], call[1]]), [
        [RELAY_AGENT, LIST_TOOL],
        [PROVIDER_AGENT, PROVIDER_STATUS_TOOL],
    ]);
});
