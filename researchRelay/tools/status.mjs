#!/usr/bin/env node
import { readEnvelope, writeOk, writeError } from './lib/envelope.mjs';
import { RESEARCH_BACKENDS, publicBackendView } from './lib/backends.mjs';

async function main() {
    try {
        await readEnvelope();
        writeOk({
            execution: {
                mode: 'tagged-task-relay',
            },
            backends: RESEARCH_BACKENDS.map(publicBackendView),
        });
    } catch (error) {
        writeError(error && error.message ? error.message : 'research_relay_status failed');
    }
}

main();
