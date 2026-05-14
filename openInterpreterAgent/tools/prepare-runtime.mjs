#!/usr/bin/env node
// Prepare (or recognize) the Open Interpreter runtime under
// /data/research-runtimes/open-interpreter/<version>/ inside the provider
// container.
//
// This tool installs the `open-interpreter` Python package into a temp
// directory staged next to the target runtime dir, copies the shim, writes a
// manifest, and atomically renames the temp dir into place. If a matching
// manifest already exists, the tool is a no-op and reports success so the
// task path can safely call it before each task. The runtime root must be an
// agent-owned absolute path; defaults are resolved through OI_RUNTIME_ROOT.

import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readEnvelope, writeOk, writeError } from './lib/envelope.mjs';
import {
    BUNDLE_ID,
    BUNDLE_VERSION,
    SHIM_HOST_PATH,
    SHIM_NAME,
    TMP_PREFIX,
    bundleDir,
    bundleParentDir,
    buildManifest,
    readExistingManifest,
    resolveRuntimeRoot,
} from './lib/runtime-bundle.mjs';

const PIP_PACKAGE = `open-interpreter==${BUNDLE_VERSION}`;
const PYTHON_BIN = process.env.OI_PREPARE_PYTHON || '/usr/local/bin/python3';
const PIP_TIMEOUT_MS = 5 * 60 * 1000;

function rmrf(target) {
    fs.rmSync(target, { recursive: true, force: true });
}

function ensureParent(runtimeRoot) {
    const parent = bundleParentDir(runtimeRoot);
    fs.mkdirSync(parent, { recursive: true, mode: 0o755 });
    return parent;
}

function copyShim(targetBinDir) {
    fs.mkdirSync(targetBinDir, { recursive: true, mode: 0o755 });
    const shimDestination = path.join(targetBinDir, SHIM_NAME);
    fs.copyFileSync(SHIM_HOST_PATH, shimDestination);
    fs.chmodSync(shimDestination, 0o755);
    return shimDestination;
}

function installPackage(tempDir, env = process.env) {
    const pythonDir = path.join(tempDir, 'python');
    fs.mkdirSync(pythonDir, { recursive: true, mode: 0o755 });
    const pythonBin = String(env.OI_PREPARE_PYTHON || PYTHON_BIN || '/usr/bin/python3').trim() || '/usr/bin/python3';
    const args = [
        '-m', 'pip', 'install',
        '--no-cache-dir',
        '--disable-pip-version-check',
        '--target', pythonDir,
        PIP_PACKAGE,
    ];
    const result = spawnSync(pythonBin, args, {
        encoding: 'utf8',
        timeout: PIP_TIMEOUT_MS,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (result.error) {
        throw new Error(`pip install failed to spawn: ${result.error.message}`);
    }
    if (result.status !== 0) {
        const stderr = String(result.stderr || '').trim().slice(-2000);
        throw new Error(`pip install exited with code ${result.status}: ${stderr}`);
    }
    return pythonDir;
}

function writeManifestFile(tempDir, manifest) {
    const target = path.join(tempDir, 'manifest.json');
    const body = `${JSON.stringify(manifest, null, 2)}\n`;
    fs.writeFileSync(target, body, { mode: 0o644 });
    return target;
}

function digestManifest(manifest) {
    const hash = crypto.createHash('sha256');
    hash.update(Buffer.from(JSON.stringify({ id: manifest.id, version: manifest.version, schema: manifest.schema })));
    return `sha256:${hash.digest('hex')}`;
}

export function prepareRuntime({ env = process.env } = {}) {
    const runtimeRoot = resolveRuntimeRoot(env);
    ensureParent(runtimeRoot);

    const existing = readExistingManifest(runtimeRoot);
    if (existing) {
        return {
            bundle: { id: BUNDLE_ID, version: BUNDLE_VERSION },
            runtimeRoot,
            bundleDir: bundleDir(runtimeRoot),
            prepared: false,
            reused: true,
            manifest: existing,
            message: `Reused existing Open Interpreter runtime bundle ${BUNDLE_ID}@${BUNDLE_VERSION}.`,
        };
    }

    if (!fs.existsSync(SHIM_HOST_PATH)) {
        throw new Error(`Open Interpreter shim missing at ${SHIM_HOST_PATH}; redeploy the openInterpreterAgent runtime files.`);
    }

    const target = bundleDir(runtimeRoot);
    if (fs.existsSync(target)) {
        throw new Error(`Open Interpreter runtime bundle target already exists at ${target} but does not contain a valid manifest. Remove or repair that directory before preparing the bundle.`);
    }

    const parent = bundleParentDir(runtimeRoot);
    const tempDir = fs.mkdtempSync(path.join(parent, TMP_PREFIX));
    try {
        fs.chmodSync(tempDir, 0o755);
        installPackage(tempDir, env);
        const binDir = path.join(tempDir, 'bin');
        copyShim(binDir);
        const manifest = buildManifest();
        manifest.digest = digestManifest(manifest);
        writeManifestFile(tempDir, manifest);

        try {
            fs.renameSync(tempDir, target);
        } catch (err) {
            const raced = readExistingManifest(runtimeRoot);
            if (raced) {
                rmrf(tempDir);
                return {
                    bundle: { id: BUNDLE_ID, version: BUNDLE_VERSION },
                    runtimeRoot,
                    bundleDir: target,
                    prepared: false,
                    reused: true,
                    manifest: raced,
                    message: `Reused concurrently prepared Open Interpreter runtime bundle ${BUNDLE_ID}@${BUNDLE_VERSION}.`,
                };
            }
            throw err;
        }

        return {
            bundle: { id: BUNDLE_ID, version: BUNDLE_VERSION },
            runtimeRoot,
            bundleDir: target,
            prepared: true,
            reused: false,
            manifest,
            message: `Prepared Open Interpreter runtime bundle ${BUNDLE_ID}@${BUNDLE_VERSION} at ${target}.`,
        };
    } catch (err) {
        rmrf(tempDir);
        throw err;
    }
}

async function main() {
    try {
        await readEnvelope();
        writeOk(prepareRuntime({ env: process.env }));
    } catch (error) {
        writeError(error && error.message ? error.message : 'prepare_runtime failed');
    }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
    main();
}
