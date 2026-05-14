#!/usr/bin/env node
import { readEnvelope, writeOk, writeError } from './lib/envelope.mjs';
import { RESEARCH_BACKENDS, publicBackendView } from './lib/backends.mjs';

async function main() {
    try {
        await readEnvelope();
        writeOk({ backends: RESEARCH_BACKENDS.map(publicBackendView) });
    } catch (error) {
        writeError(error && error.message ? error.message : 'list_backends failed');
    }
}

main();
