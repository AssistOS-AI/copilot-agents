#!/usr/bin/env node
import { handleChatCompletion, readStdinJson } from './lib/chat-handler.mjs';

async function main() {
    try {
        const payload = await readStdinJson();
        const response = await handleChatCompletion(payload?.request || {}, payload, process.env);
        process.stdout.write(`${JSON.stringify(response)}\n`);
    } catch (error) {
        process.stderr.write(`${error?.message || 'GPTResearcher chat handler failed'}\n`);
        process.exit(1);
    }
}

main();
