#!/usr/bin/env node
import { readEnvelope, writeOk, writeError } from './lib/envelope.mjs';
import { COPILOT_PROVIDER_BACKENDS, publicBackendView } from './lib/backends.mjs';

async function main() {
    try {
        await readEnvelope();
        writeOk({
            execution: {
                mode: 'copilot-provider-relay',
            },
            backends: COPILOT_PROVIDER_BACKENDS.map(publicBackendView),
        });
    } catch (error) {
        writeError(error && error.message ? error.message : 'copilot_provider_status failed');
    }
}

main();
