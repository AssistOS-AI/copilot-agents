import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { achillesAgentRoot } from '../fixtures/cross-repository-roots.mjs';

const AGENT_ROOT = achillesAgentRoot('codexAgent');
const MANIFEST = path.join(AGENT_ROOT, 'manifest.json');
const INSTALL_SCRIPT = path.join(AGENT_ROOT, 'scripts', 'install-codex.sh');
const RUNNER = path.join(AGENT_ROOT, 'scripts', 'codex-runner.mjs');

test('codex manifest uses the non-interactive installer script', async () => {
    const manifest = JSON.parse(await fs.readFile(MANIFEST, 'utf8'));
    const install = manifest.profiles?.default?.install;

    assert.equal(install, 'sh /code/scripts/install-codex.sh');
    assert.doesNotMatch(install, /^npm install/);
});

test('codex runner pins managed Explorer tasks to the concrete Soul model without embedding credentials', async () => {
    const script = await fs.readFile(RUNNER, 'utf8');

    assert.match(script, /PLOINKY_ROUTER_URL/);
    assert.match(script, /PLOINKY_AGENT_API_KEY/);
    assert.match(script, /base-agent-additional-server\/soul-gateway\/7000\/v1/);
    assert.match(script, /MANAGED_SOUL_MODEL = 'gpt-5\.6-sol'/);
    assert.match(script, /env_key/);
    assert.doesNotMatch(script, /sk-[A-Za-z0-9_-]{16,}/);
});

test('codex installer invokes npm through the absolute npm cli path', async () => {
    const script = await fs.readFile(INSTALL_SCRIPT, 'utf8');

    assert.match(script, /\/opt\/ploinky-node\/lib\/node_modules\/npm\/bin\/npm-cli\.js/);
    assert.match(script, /\/usr\/local\/lib\/node_modules\/npm\/bin\/npm-cli\.js/);
    assert.match(script, /node "\$NPM_CLI" install -g --prefix "\$INSTALL_PREFIX"/);
    assert.match(script, /@openai\/codex/);
    assert.match(script, /exec node "\$HOME\/\.local\/lib\/node_modules\/@openai\/codex\/bin\/codex\.js" "\$@"/);
    assert.doesNotMatch(script, /\bnpm install -g\b/);
});
