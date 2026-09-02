import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
    containerSecurityValidationErrors,
    gatedPrivilegeMatches,
    writableVolumeValidationErrors,
} from '../../scripts/validate-manifests.mjs';

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

test('Open Interpreter privilege transition is limited to its exact selected image and declaration', () => {
    const manifest = JSON.parse(fs.readFileSync(new URL('../../openInterpreterAgent/manifest.json', import.meta.url), 'utf8'));
    assert.equal(gatedPrivilegeMatches('openInterpreterAgent', manifest), true);
    assert.equal(gatedPrivilegeMatches('anotherProvider', manifest), false);
    for (const container of [
        'docker.io/assistos/bwrap-runner:node24-python-bookworm',
        'docker.io/assistos/bwrap-runner:node24-python-trixie',
        `docker.io/assistos/bwrap-runner@sha256:${'a'.repeat(64)}`,
        'docker.io/other/runner:latest',
    ]) {
        assert.equal(gatedPrivilegeMatches('openInterpreterAgent', { ...manifest, container }), false);
    }
    for (const privileged of [false, 'true', null]) {
        assert.equal(gatedPrivilegeMatches('openInterpreterAgent', { ...manifest, containerSecurity: { privileged } }), false);
    }
    assert.match(manifest.agent, /healthcheck\.mjs --minimum=private &&/);
});

test('writable volume validation positively accepts only normalized .data descendants', () => {
    assert.deepEqual(writableVolumeValidationErrors({ container: 'node:24-bookworm' }), []);
    assert.deepEqual(writableVolumeValidationErrors({
        container: 'node:24-bookworm',
        volumes: {
            '.data/browserUseAgent': '/data',
            '.data/browserUseAgent/cache': '/cache',
        },
    }), []);
});

test('writable volume validation rejects legacy, ambiguous, absolute, and non-canonical host roots', () => {
    for (const hostPath of [
        '.ploinky/data/browserUseAgent',
        'webassist-data',
        '.data-other/browserUseAgent',
        '.data',
    ]) {
        assert.deepEqual(
            writableVolumeValidationErrors({ volumes: { [hostPath]: '/data' } }),
            [`writable host volume must resolve beneath .data/: ${hostPath}`],
        );
    }
    assert.deepEqual(
        writableVolumeValidationErrors({ volumes: { '/workspace/.data/browserUseAgent': '/data' } }),
        ['writable host volume must be workspace-relative beneath .data/: /workspace/.data/browserUseAgent'],
    );
    assert.deepEqual(
        writableVolumeValidationErrors({ volumes: { '.data/browserUseAgent/../webSearchAgent': '/data' } }),
        ['writable host volume must already be normalized: .data/browserUseAgent/../webSearchAgent'],
    );
});

test('writable volume validation requires object-map shape and absolute container targets', () => {
    assert.deepEqual(
        writableVolumeValidationErrors({ volumes: ['.data/browserUseAgent:/data'] }),
        ['volumes must be an object map of host path to container path'],
    );
    assert.deepEqual(
        writableVolumeValidationErrors({ volumes: { '.data/browserUseAgent': 'data' } }),
        ['volume container path must be absolute: "data"'],
    );
});

test('writable volume validation checks every profile even without root volumes', () => {
    for (const profile of ['default', 'dev', 'qa', 'prod']) {
        for (const hostPath of ['webassist-data', '.ploinky/data/browserUseAgent', '.ploinky/shared', '.data-other/agent']) {
            assert.deepEqual(writableVolumeValidationErrors({
                profiles: { [profile]: { volumes: { [hostPath]: '/data' } } },
            }), [`profile ${profile}: writable host volume must resolve beneath .data/: ${hostPath}`]);
        }
        assert.deepEqual(writableVolumeValidationErrors({
            profiles: { [profile]: { volumes: { '.data/browserUseAgent/cache': '/cache' } } },
        }), []);
    }
    assert.deepEqual(writableVolumeValidationErrors({
        volumes: { '.data/root': '/root-data' },
        profiles: { default: { volumes: ['.data/browserUseAgent:/data'] } },
    }), ['profile default: volumes must be an object map of host path to container path']);
    assert.deepEqual(writableVolumeValidationErrors({ profiles: [] }), ['profiles must be an object map']);
    assert.deepEqual(writableVolumeValidationErrors({ profiles: { default: null } }), ['profile default must be an object']);
});

test('provider manifests use exact unique-agent storage mappings', () => {
    for (const agentName of ['browserUseAgent', 'openInterpreterAgent', 'webSearchAgent']) {
        const manifest = JSON.parse(fs.readFileSync(
            path.resolve(fixtureRoot, '../../..', agentName, 'manifest.json'),
            'utf8',
        ));
        assert.deepEqual(manifest.volumes, {
            [`.data/${agentName}`]: '/data',
        });
        assert.deepEqual(writableVolumeValidationErrors(manifest), []);
    }
});
