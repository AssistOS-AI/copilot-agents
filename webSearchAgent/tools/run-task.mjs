#!/usr/bin/env node
import { readEnvelope, writeOk, writeError } from './lib/envelope.mjs';
import { normalizeSearchInput, executeSearch } from './lib/search-executor.mjs';

function getInvocationToken(envelope) {
    return envelope.metadata && typeof envelope.metadata.invocationToken === 'string'
        ? envelope.metadata.invocationToken
        : '';
}

async function main() {
    try {
        const envelope = await readEnvelope();
        const invocationToken = getInvocationToken(envelope);
        if (!invocationToken) {
            writeError('web_search_run_task requires a router invocation token');
            return;
        }

        const input = normalizeSearchInput(envelope.input || {});
        if (input.error) {
            writeError(input.error);
            return;
        }

        const result = await executeSearch(input, process.env);
        writeOk(result);
    } catch (error) {
        writeError(error && error.message ? error.message : 'web_search_run_task failed');
    }
}

main();
