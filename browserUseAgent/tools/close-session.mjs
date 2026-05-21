#!/usr/bin/env node
import { readEnvelope, writeOk, writeError } from './lib/envelope.mjs';
import { resolveServiceConfig } from './lib/config.mjs';
import { getUserId } from './lib/identity.mjs';

async function main() {
    try {
        const envelope = await readEnvelope();
        const input = envelope.input || {};
        const sessionId = String(input.sessionId || '').trim();
        const provider = String(input.provider || '').trim();
        const clearProfile = Boolean(input.clearProfile);

        if (!sessionId && !provider) {
            writeError('sessionId or provider is required');
            return;
        }
        const userId = getUserId(envelope);
        if (!userId) {
            writeError('browser_use_close_session requires an authenticated user identity');
            return;
        }

        const config = resolveServiceConfig(process.env);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10000);

        try {
            const response = await fetch(`${config.serviceUrl}/browser-use/close-session`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ sessionId, provider, clearProfile, userId }),
                signal: controller.signal,
            });
            if (!response.ok) {
                writeError(`service responded ${response.status}`);
                return;
            }
            const body = await response.json();
            writeOk(body);
        } catch {
            writeError('browser service is not reachable');
        } finally {
            clearTimeout(timer);
        }
    } catch (error) {
        writeError(error && error.message ? error.message : 'browser_use_close_session failed');
    }
}

main();
