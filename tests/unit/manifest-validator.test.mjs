import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { containerSecurityValidationErrors } from '../../scripts/validate-manifests.mjs';

const fixtureRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../fixtures/manifest-security',
);

function fixture(name) {
    return JSON.parse(fs.readFileSync(path.join(fixtureRoot, name), 'utf8'));
}

test('manifest security accepts absent, empty, and explicitly unprivileged root objects', () => {
    for (const manifest of [
        { container: 'node:24-bookworm' },
        { container: 'node:24-bookworm', containerSecurity: {} },
        { container: 'node:24-bookworm', containerSecurity: { privileged: false } },
    ]) {
        assert.deepEqual(containerSecurityValidationErrors(manifest), []);
    }
});

test('manifest security rejects malformed root security values and unknown fields', () => {
    for (const value of [null, [], 'privileged', 1, true]) {
        assert.deepEqual(
            containerSecurityValidationErrors({ container: 'node:24-bookworm', containerSecurity: value }),
            ['containerSecurity must be a plain object'],
        );
    }
    assert.deepEqual(
        containerSecurityValidationErrors({
            container: 'node:24-bookworm',
            containerSecurity: { privileged: 'true', rawArgs: ['--privileged'] },
        }),
        [
            'containerSecurity.rawArgs is unsupported',
            'containerSecurity.privileged must be boolean',
        ],
    );
});

test('manifest security rejects privileged providers by default', () => {
    assert.deepEqual(
        containerSecurityValidationErrors(fixture('privileged-provider.json')),
        ['privileged provider manifests are unsupported'],
    );
});

test('manifest security rejects containerSecurity in every profile placement', () => {
    assert.deepEqual(
        containerSecurityValidationErrors(fixture('profile-security.json')),
        ['profile qa.containerSecurity is unsupported; containerSecurity is root-only'],
    );
    const manifest = {
        container: 'node:24-bookworm',
        profiles: Object.fromEntries(
            ['default', 'dev', 'qa', 'prod'].map((name) => [name, { containerSecurity: {} }]),
        ),
    };
    assert.deepEqual(containerSecurityValidationErrors(manifest), [
        'profile default.containerSecurity is unsupported; containerSecurity is root-only',
        'profile dev.containerSecurity is unsupported; containerSecurity is root-only',
        'profile qa.containerSecurity is unsupported; containerSecurity is root-only',
        'profile prod.containerSecurity is unsupported; containerSecurity is root-only',
    ]);
});

test('temporary privilege allowance is explicit and does not relax syntax validation', () => {
    assert.deepEqual(
        containerSecurityValidationErrors(fixture('privileged-provider.json'), { allowPrivileged: true }),
        [],
    );
    assert.deepEqual(
        containerSecurityValidationErrors({
            container: 'node:24-bookworm',
            containerSecurity: { privileged: true, securityOpt: ['unconfined'] },
        }, { allowPrivileged: true }),
        ['containerSecurity.securityOpt is unsupported'],
    );
});
