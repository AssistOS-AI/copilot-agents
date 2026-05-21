#!/usr/bin/env node
import { readEnvelope, writeOk, writeError } from './lib/envelope.mjs';
import { resolveServiceConfig, clampTimeout } from './lib/config.mjs';
import { getInvocationToken, getUserId } from './lib/identity.mjs';

async function main() {
    try {
        const envelope = await readEnvelope();
        const invocationToken = getInvocationToken(envelope);
        if (!invocationToken) {
            writeError('browser_use_continue_task requires a router invocation token');
            return;
        }

        const jobId = String((envelope.input || {}).jobId || '').trim();
        if (!jobId) {
            writeError('jobId is required');
            return;
        }
        const userId = getUserId(envelope);
        if (!userId) {
            writeError('browser_use_continue_task requires an authenticated user identity');
            return;
        }

        const config = resolveServiceConfig(process.env);
        const timeoutMs = clampTimeout(config.timeoutMs);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs + 30000);

        try {
            const response = await fetch(`${config.serviceUrl}/browser-use/continue-task`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ jobId, userId }),
                signal: controller.signal,
            });
            if (!response.ok) {
                writeError(`service responded ${response.status}`);
                return;
            }
            const body = await response.json();
            writeOk(body);
        } catch (error) {
            if (error?.name === 'AbortError') {
                writeError('continue task timed out');
                return;
            }
            writeError('browser service is not reachable');
        } finally {
            clearTimeout(timer);
        }
    } catch (error) {
        writeError(error && error.message ? error.message : 'browser_use_continue_task failed');
    }
}

main();
