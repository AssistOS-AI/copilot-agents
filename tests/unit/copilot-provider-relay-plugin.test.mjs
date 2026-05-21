import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');

function readJson(relativePath) {
    return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'));
}

test('copilotProviderRelay contributes launch metadata instead of a separate Explorer menu item', () => {
    const config = readJson('copilotProviderRelay/IDE-plugins/copilot-provider-relay/config.json');
    assert.deepEqual(config.location, ['file-exp:copilot-launch-extension']);
    assert.equal(config.label, 'Copilot provider relay metadata');
    assert.deepEqual(config.copilotLaunch.query, { 'forward-envelope': '1' });
    assert.equal(config.copilotLaunch.workspaceDirParam, 'workspace-dir');
});

test('copilotProviderRelay does not expose an Open Copilot Provider Relay context-menu plugin', () => {
    const menuDir = path.join(repoRoot, 'copilotProviderRelay', 'IDE-plugins', 'copilot-provider-relay-menu');
    assert.equal(fs.existsSync(menuDir), false);
});
