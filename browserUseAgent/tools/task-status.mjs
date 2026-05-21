#!/usr/bin/env node
import { readEnvelope, writeOk, writeError } from './lib/envelope.mjs';
import { resolveServiceConfig } from './lib/config.mjs';
import { getUserId } from './lib/identity.mjs';

async function main() {
    try {
        const envelope = await readEnvelope();
        const jobId = String((envelope.input || {}).jobId || '').trim();
        if (!jobId) {
            writeError('jobId is required');
            return;
        }
        const userId = getUserId(envelope);
        if (!userId) {
            writeError('browser_use_task_status requires an authenticated user identity');
            return;
        }

        const config = resolveServiceConfig(process.env);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10000);

        try {
            const response = await fetch(
                `${config.serviceUrl}/browser-use/task-status?jobId=${encodeURIComponent(jobId)}&userId=${encodeURIComponent(userId)}`,
                {
                    method: 'GET',
                    headers: { accept: 'application/json' },
                    signal: controller.signal,
                },
            );
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
        writeError(error && error.message ? error.message : 'browser_use_task_status failed');
    }
}

main();
