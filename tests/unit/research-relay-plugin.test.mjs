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

test('researchRelay contributes launch metadata instead of a separate Explorer menu item', () => {
    const config = readJson('researchRelay/IDE-plugins/research-relay/config.json');
    assert.deepEqual(config.location, ['file-exp:copilot-launch-extension']);
    assert.equal(config.label, 'Research tag relay');
    assert.equal(config.copilotLaunch.query['research-tags'], '1');
    assert.equal(config.copilotLaunch.query['forward-envelope'], '1');
    assert.equal(config.copilotLaunch.query['tag-relay-agent'], 'researchRelay');
    assert.equal(config.copilotLaunch.query['tag-relay-submit-tool'], 'research_task_submit');
    assert.equal(config.copilotLaunch.query['tag-relay-list-tool'], 'research_relay_list_backends');
    assert.equal(config.copilotLaunch.query['tag-relay-tags'], 'open-interpreter,oi');
    assert.equal(config.copilotLaunch.workspaceDirParam, 'workspace-dir');
});

test('researchRelay does not expose an Open Research Relay context-menu plugin', () => {
    const menuDir = path.join(repoRoot, 'researchRelay', 'IDE-plugins', 'research-relay-menu');
    assert.equal(fs.existsSync(menuDir), false);
});
