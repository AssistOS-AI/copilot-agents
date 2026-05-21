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
} from '../../achilles-skills/launch-browser-use/src/index.mjs';

function jsonResponse(payload) {
    return {
        result: {
            content: [{ type: 'text', text: JSON.stringify(payload) }],
        },
    };
}

test('launcher metadata targets copilotProviderRelay and browser-use backend', () => {
    assert.equal(BACKEND, 'browser-use');
    assert.equal(RELAY_AGENT, 'copilotProviderRelay');
    assert.equal(PROVIDER_AGENT, 'browserUseAgent');
    assert.equal(LIST_TOOL, 'copilot_provider_list_backends');
    assert.equal(SUBMIT_TOOL, 'copilot_provider_task_submit');
    assert.equal(PROVIDER_STATUS_TOOL, 'browser_use_status');
});

test('action refuses to dispatch without a router invocation token', async () => {
    const calls = [];
    const result = await action({
        prompt: 'use ChatGPT to summarize this',
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

test('@browser-use is ordinary chat text and never calls copilot_provider_task_submit', async () => {
    const calls = [];
    const result = await action({
        prompt: '@browser-use open ChatGPT',
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

test('@browser alone is ordinary chat text', async () => {
    const calls = [];
    const result = await action({
        prompt: '@browser open something',
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

test('action reports missing browser-use backend without Ploinky enable guidance', async () => {
    const result = await action({
        prompt: 'use ChatGPT to answer a question',
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
        prompt: 'use ChatGPT to answer a question',
        context: { invocationToken: 'caller-token' },
        callAgentTool: async (...args) => {
            calls.push(args);
            const [, toolName] = args;
            if (toolName === LIST_TOOL) {
                return jsonResponse({
                    backends: [{ id: BACKEND, provider: { agent: PROVIDER_AGENT } }],
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
    assert.match(result.result_text, /provider agent browserUseAgent is not reachable/);
    assert.deepEqual(calls.map((c) => [c[0], c[1]]), [
        [RELAY_AGENT, LIST_TOOL],
        [PROVIDER_AGENT, PROVIDER_STATUS_TOOL],
    ]);
});

test('successful submit with waiting_for_user returns viewer URL', async () => {
    const calls = [];
    const result = await action({
        prompt: 'use ChatGPT to summarize this paper',
        context: { invocationToken: 'caller-token', workingDir: '/workspace' },
        callAgentTool: async (...args) => {
            calls.push(args);
            const [, toolName] = args;
            if (toolName === LIST_TOOL) {
                return jsonResponse({
                    backends: [{ id: BACKEND, provider: { agent: PROVIDER_AGENT } }],
                });
            }
            if (toolName === PROVIDER_STATUS_TOOL) {
                return jsonResponse({ agent: PROVIDER_AGENT, ok: true });
            }
            return jsonResponse({
                ok: true,
                backend_ok: true,
                state: 'waiting_for_user',
                requires_user_action: true,
                jobId: 'job_abc123',
                sessionId: 'sess_def456',
                viewerUrl: '/services/browser-use/sessions/sess_def456',
                final_answer: '',
            });
        },
    });

    assert.equal(result.ok, true);
    assert.equal(result.cacheable, false);
    assert.equal(result.backend, 'browser-use');
    assert.match(result.result_text, /log in first/);
    assert.match(result.result_text, /http:\/\/localhost:8080\/services\/browser-use\/sessions\/sess_def456/);
    assert.equal(result.diagnostics.requires_user_action, true);
    assert.equal(result.diagnostics.interactive, true);
    assert.equal(result.diagnostics.viewerUrl, '/services/browser-use/sessions/sess_def456');
    assert.equal(result.diagnostics.viewerFullUrl, 'http://localhost:8080/services/browser-use/sessions/sess_def456');
    assert.equal(result.diagnostics.jobId, 'job_abc123');
    assert.equal(result.persistence_hint.ku_type, 'agent.result.browser-use');
    assert.equal(result.persistence_hint.record_result, false);
    assert.equal(calls.length, 3);
    assert.deepEqual(calls.map((c) => [c[0], c[1]]), [
        [RELAY_AGENT, LIST_TOOL],
        [PROVIDER_AGENT, PROVIDER_STATUS_TOOL],
        [RELAY_AGENT, SUBMIT_TOOL],
    ]);
    assert.equal(calls[2][2].backend, BACKEND);
    assert.equal(calls[2][2].provider, 'chatgpt');
    assert.equal(calls[2][2].origin.type, 'semantic-copilot');
});

test('waiting_for_user viewer URL uses public webchat origin when supplied', async () => {
    const result = await action({
        prompt: 'use Gemini in the browser',
        env: {
            PLOINKY_ROUTER_HOST: 'host.containers.internal',
            PLOINKY_ROUTER_PORT: '8080',
        },
        context: {
            invocationToken: 'caller-token',
            webchatOrigin: { publicBaseUrl: 'https://workspace.example.test/webchat?agent=achilles-cli' },
        },
        callAgentTool: async (...args) => {
            const [, toolName] = args;
            if (toolName === LIST_TOOL) {
                return jsonResponse({
                    backends: [{ id: BACKEND, provider: { agent: PROVIDER_AGENT } }],
                });
            }
            if (toolName === PROVIDER_STATUS_TOOL) {
                return jsonResponse({ agent: PROVIDER_AGENT, ok: true });
            }
            return jsonResponse({
                ok: true,
                backend_ok: true,
                state: 'waiting_for_user',
                requires_user_action: true,
                sessionId: 'sess_public',
                viewerUrl: '/services/browser-use/sessions/sess_public',
            });
        },
    });

    assert.equal(result.ok, true);
    assert.match(result.result_text, /https:\/\/workspace\.example\.test\/services\/browser-use\/sessions\/sess_public/);
    assert.equal(result.diagnostics.viewerFullUrl, 'https://workspace.example.test/services/browser-use/sessions/sess_public');
});

test('reused browser-use sessions return the existing viewer URL without generic backend fallback', async () => {
    const result = await action({
        prompt: 'use Gemini to find the latest Node.js release',
        context: { invocationToken: 'caller-token' },
        callAgentTool: async (...args) => {
            const [, toolName] = args;
            if (toolName === LIST_TOOL) {
                return jsonResponse({
                    backends: [{ id: BACKEND, provider: { agent: PROVIDER_AGENT } }],
                });
            }
            if (toolName === PROVIDER_STATUS_TOOL) {
                return jsonResponse({ agent: PROVIDER_AGENT, ok: true });
            }
            return jsonResponse({
                ok: true,
                backend_ok: true,
                state: 'waiting_for_user',
                requires_user_action: true,
                session_reused: true,
                sessionId: 'sess_reused',
                viewerUrl: '/services/browser-use/sessions/sess_reused',
                final_answer: '',
            });
        },
    });

    assert.equal(result.ok, true);
    assert.match(result.result_text, /already open/);
    assert.doesNotMatch(result.result_text, /did not return a natural-language response/);
    assert.match(result.result_text, /http:\/\/localhost:8080\/services\/browser-use\/sessions\/sess_reused/);
    assert.equal(result.diagnostics.session_reused, true);
});

test('Gemini prompts submit browser-use task with gemini provider', async () => {
    const calls = [];
    const result = await action({
        prompt: 'Ask Gemini to translate hello to French',
        context: { invocationToken: 'caller-token' },
        callAgentTool: async (...args) => {
            calls.push(args);
            const [, toolName] = args;
            if (toolName === LIST_TOOL) {
                return jsonResponse({
                    backends: [{ id: BACKEND, provider: { agent: PROVIDER_AGENT } }],
                });
            }
            if (toolName === PROVIDER_STATUS_TOOL) {
                return jsonResponse({ agent: PROVIDER_AGENT, ok: true });
            }
            return jsonResponse({
                ok: true,
                backend_ok: true,
                state: 'completed',
                final_answer: 'Bonjour',
            });
        },
    });

    assert.equal(result.ok, true);
    assert.equal(result.result_text, 'Bonjour');
    assert.equal(calls[2][2].provider, 'gemini');
});

test('successful submit with completed state returns final answer', async () => {
    const result = await action({
        prompt: 'use ChatGPT to translate hello to French',
        context: { invocationToken: 'caller-token' },
        callAgentTool: async (...args) => {
            const [, toolName] = args;
            if (toolName === LIST_TOOL) {
                return jsonResponse({
                    backends: [{ id: BACKEND, provider: { agent: PROVIDER_AGENT } }],
                });
            }
            if (toolName === PROVIDER_STATUS_TOOL) {
                return jsonResponse({ agent: PROVIDER_AGENT, ok: true });
            }
            return jsonResponse({
                ok: true,
                backend_ok: true,
                state: 'completed',
                final_answer: 'Bonjour',
            });
        },
    });

    assert.equal(result.ok, true);
    assert.equal(result.cacheable, false);
    assert.equal(result.result_text, 'Bonjour');
    assert.equal(result.diagnostics.providerAvailability, 'active');
});

test('explicit provider input wins over prompt alias matching', async () => {
    const calls = [];
    const result = await action({
        prompt: 'Ask Gemini to translate hello',
        provider: 'perplexity',
        context: { invocationToken: 'caller-token' },
        callAgentTool: async (...args) => {
            calls.push(args);
            const [, toolName] = args;
            if (toolName === LIST_TOOL) {
                return jsonResponse({
                    backends: [{ id: BACKEND, provider: { agent: PROVIDER_AGENT } }],
                });
            }
            if (toolName === PROVIDER_STATUS_TOOL) {
                return jsonResponse({
                    agent: PROVIDER_AGENT,
                    ok: true,
                    providers: [
                        { id: 'chatgpt', label: 'ChatGPT', aliases: ['chatgpt', 'openai'], default: true },
                        { id: 'gemini', label: 'Gemini', aliases: ['gemini', 'google gemini'] },
                        { id: 'perplexity', label: 'Perplexity', aliases: ['perplexity'] },
                    ],
                });
            }
            return jsonResponse({ ok: true, state: 'completed', final_answer: 'done' });
        },
    });

    assert.equal(result.ok, true);
    assert.equal(calls[2][2].provider, 'perplexity');
});

test('launcher matches provider aliases from status catalog', async () => {
    const calls = [];
    const result = await action({
        prompt: 'use openai to translate hello',
        context: { invocationToken: 'caller-token' },
        callAgentTool: async (...args) => {
            calls.push(args);
            const [, toolName] = args;
            if (toolName === LIST_TOOL) {
                return jsonResponse({
                    backends: [{ id: BACKEND, provider: { agent: PROVIDER_AGENT } }],
                });
            }
            if (toolName === PROVIDER_STATUS_TOOL) {
                return jsonResponse({
                    agent: PROVIDER_AGENT,
                    ok: true,
                    providers: [
                        { id: 'chatgpt', label: 'ChatGPT', aliases: ['chatgpt', 'openai', 'chat gpt'], default: true },
                        { id: 'gemini', label: 'Gemini', aliases: ['gemini'] },
                    ],
                });
            }
            return jsonResponse({ ok: true, state: 'completed', final_answer: 'done' });
        },
    });

    assert.equal(result.ok, true);
    assert.equal(calls[2][2].provider, 'chatgpt');
});

test('launcher falls back to catalog default provider when prompt has no alias match', async () => {
    const calls = [];
    const result = await action({
        prompt: 'translate hello to French',
        context: { invocationToken: 'caller-token' },
        callAgentTool: async (...args) => {
            calls.push(args);
            const [, toolName] = args;
            if (toolName === LIST_TOOL) {
                return jsonResponse({
                    backends: [{ id: BACKEND, provider: { agent: PROVIDER_AGENT } }],
                });
            }
            if (toolName === PROVIDER_STATUS_TOOL) {
                return jsonResponse({
                    agent: PROVIDER_AGENT,
                    ok: true,
                    providers: [
                        { id: 'chatgpt', label: 'ChatGPT', aliases: ['chatgpt', 'openai'], default: true },
                        { id: 'gemini', label: 'Gemini', aliases: ['gemini'] },
                    ],
                });
            }
            return jsonResponse({ ok: true, state: 'completed', final_answer: 'done' });
        },
    });

    assert.equal(result.ok, true);
    assert.equal(calls[2][2].provider, 'chatgpt');
});

test('launcher preserves origin.publicBaseUrl precedence from webchat', async () => {
    const calls = [];
    await action({
        prompt: 'use ChatGPT to do something',
        env: {
            PLOINKY_ROUTER_HOST: 'host.containers.internal',
            PLOINKY_ROUTER_PORT: '8080',
        },
        origin: { publicBaseUrl: 'https://my.domain.test' },
        context: { invocationToken: 'caller-token' },
        callAgentTool: async (...args) => {
            calls.push(args);
            const [, toolName] = args;
            if (toolName === LIST_TOOL) {
                return jsonResponse({
                    backends: [{ id: BACKEND, provider: { agent: PROVIDER_AGENT } }],
                });
            }
            if (toolName === PROVIDER_STATUS_TOOL) {
                return jsonResponse({ agent: PROVIDER_AGENT, ok: true });
            }
            return jsonResponse({
                ok: true,
                state: 'waiting_for_user',
                requires_user_action: true,
                sessionId: 'sess_origin',
                viewerUrl: '/services/browser-use/sessions/sess_origin',
            });
        },
    });

    const submitArgs = calls[2][3];
    assert.equal(submitArgs.env.PLOINKY_ROUTER_HOST, 'host.containers.internal');
});

test('launcher uses hardcoded chatgpt fallback when status returns no provider catalog', async () => {
    const calls = [];
    await action({
        prompt: 'translate hello to French',
        context: { invocationToken: 'caller-token' },
        callAgentTool: async (...args) => {
            calls.push(args);
            const [, toolName] = args;
            if (toolName === LIST_TOOL) {
                return jsonResponse({
                    backends: [{ id: BACKEND, provider: { agent: PROVIDER_AGENT } }],
                });
            }
            if (toolName === PROVIDER_STATUS_TOOL) {
                return jsonResponse({ agent: PROVIDER_AGENT, ok: true });
            }
            return jsonResponse({ ok: true, state: 'completed', final_answer: 'done' });
        },
    });

    assert.equal(calls[2][2].provider, 'chatgpt');
});
