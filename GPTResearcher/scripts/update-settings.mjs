#!/usr/bin/env node
import { readStdinJson } from './lib/chat-handler.mjs';
import { SETTINGS_FILE_NAME, writeWorkspaceSettings } from './lib/settings.mjs';
import { resolveWorkspaceRoot } from './lib/workspace-context.mjs';

async function main() {
    try {
        const envelope = await readStdinJson();
        const input = envelope?.input && typeof envelope.input === 'object' ? envelope.input : {};
        const workspaceRoot = resolveWorkspaceRoot(process.env);
        const settings = writeWorkspaceSettings(workspaceRoot, input);
        process.stdout.write(`${JSON.stringify({
            ok: true,
            settings,
            path: SETTINGS_FILE_NAME,
        })}\n`);
    } catch (error) {
        process.stdout.write(`${JSON.stringify({
            ok: false,
            error: error?.message || 'Failed to update GPTResearcher settings',
        })}\n`);
        process.exit(1);
    }
}

main();
