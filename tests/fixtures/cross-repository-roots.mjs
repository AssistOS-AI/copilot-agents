import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURES_DIR = path.dirname(fileURLToPath(import.meta.url));

export const COPILOT_AGENTS_ROOT = path.resolve(FIXTURES_DIR, '..', '..');
export const WORKSPACE_ROOT = path.resolve(COPILOT_AGENTS_ROOT, '..');
export const ACHILLESCLI_ROOT = path.resolve(
    process.env.ACHILLESCLI_TEST_ROOT || path.join(WORKSPACE_ROOT, 'AchillesCLI'),
);

export function achillesAgentRoot(agentName) {
    const root = path.join(ACHILLESCLI_ROOT, agentName);
    if (!fs.existsSync(path.join(root, 'manifest.json'))) {
        const error = new Error(
            `COPILOT_CROSS_REPOSITORY_FIXTURE_MISSING: expected ${agentName} under ${ACHILLESCLI_ROOT}`,
        );
        error.code = 'COPILOT_CROSS_REPOSITORY_FIXTURE_MISSING';
        throw error;
    }
    return root;
}
