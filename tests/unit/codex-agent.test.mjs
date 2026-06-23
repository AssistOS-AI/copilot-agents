import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TESTS_DIR, '..', '..');
const MANIFEST = path.join(REPO_ROOT, 'codexAgent', 'manifest.json');
const INSTALL_SCRIPT = path.join(REPO_ROOT, 'codexAgent', 'scripts', 'install-codex.sh');

test('codex manifest uses the non-interactive installer script', async () => {
    const manifest = JSON.parse(await fs.readFile(MANIFEST, 'utf8'));
    const install = manifest.profiles?.default?.install;

    assert.equal(install, 'sh /code/scripts/install-codex.sh');
    assert.doesNotMatch(install, /^npm install/);
});

test('codex installer invokes npm through the absolute npm cli path', async () => {
    const script = await fs.readFile(INSTALL_SCRIPT, 'utf8');

    assert.match(script, /node \/usr\/local\/lib\/node_modules\/npm\/bin\/npm-cli\.js install -g/);
    assert.match(script, /@openai\/codex/);
    assert.match(script, /exec node \/usr\/local\/lib\/node_modules\/@openai\/codex\/bin\/codex\.js "\$@"/);
    assert.doesNotMatch(script, /\bnpm install -g\b/);
});
