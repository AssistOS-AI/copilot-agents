#!/usr/bin/env node
import { readEnvelope, writeOk, writeError } from './lib/envelope.mjs';
import { resolveServiceConfig, clampTimeout } from './lib/config.mjs';
import { getInvocationToken, getUserId } from './lib/identity.mjs';

const MAX_PROMPT_CHARS = 4000;

function normalizeInput(input = {}) {
    const prompt = String(input.prompt || '').trim();
    if (!prompt) {
        return { error: 'A prompt is required.' };
    }
    if (prompt.length > MAX_PROMPT_CHARS) {
        return { error: `Prompt exceeds ${MAX_PROMPT_CHARS} characters.` };
    }
    const provider = String(input.provider || 'chatgpt').trim().toLowerCase();
    const timeoutMs = clampTimeout(input.timeoutMs);
    const origin = input.origin && typeof input.origin === 'object' ? input.origin : {};
    return { prompt, provider, timeoutMs, origin };
}

async function executeTask(input, userId, config) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), input.timeoutMs + 30000);

    try {
        const response = await fetch(`${config.serviceUrl}/browser-use/run-task`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                prompt: input.prompt,
                provider: input.provider,
                userId,
                timeoutMs: input.timeoutMs,
                origin: input.origin,
            }),
            signal: controller.signal,
        });

        if (!response.ok) {
            return {
                ok: true,
                backend_ok: false,
                final_answer: `Browser task failed: service responded ${response.status}.`,
                natural_language_output: `Browser task failed: service responded ${response.status}.`,
                sources: [],
                cacheable: false,
            };
        }

        return await response.json();
    } catch (error) {
        if (error?.name === 'AbortError') {
            return {
                ok: true,
                backend_ok: false,
                final_answer: `Browser task timed out after ${input.timeoutMs}ms.`,
                natural_language_output: 'Browser task timed out.',
                sources: [],
                cacheable: false,
            };
        }
        return {
            ok: true,
            backend_ok: false,
            final_answer: 'Browser task is unavailable because the local service is not reachable.',
            natural_language_output: 'Browser task is unavailable because the local service is not reachable.',
            sources: [],
            cacheable: false,
        };
    } finally {
        clearTimeout(timer);
    }
}

async function main() {
    try {
        const envelope = await readEnvelope();
        const invocationToken = getInvocationToken(envelope);
        if (!invocationToken) {
            writeError('browser_use_run_task requires a router invocation token');
            return;
        }

        const input = normalizeInput(envelope.input || {});
        if (input.error) {
            writeError(input.error);
            return;
        }

        const userId = getUserId(envelope);
        if (!userId) {
            writeError('browser_use_run_task requires an authenticated user identity');
            return;
        }
        const config = resolveServiceConfig(process.env);
        const result = await executeTask(input, userId, config);
        writeOk(result);
    } catch (error) {
        writeError(error && error.message ? error.message : 'browser_use_run_task failed');
    }
}

main();
