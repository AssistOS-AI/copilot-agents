// Helpers for openInterpreterAgent runtime preparation and resolution.

import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const BUNDLE_ID = 'open-interpreter';
export const BUNDLE_VERSION = '0.4.3';
export const SCHEMA = 'ploinky.research-runtime';
export const RUNNER_ABI = 2;
export const RUNNER_PROC_MINIMUM = 'private';
export const SHIM_NAME = 'research-open-interpreter.py';
export const SHIM_HOST_PATH = '/code/runtime/research-open-interpreter.py';
export const DEFAULT_RUNTIME_ROOT = '/data/research-runtimes';
export const RUNNER_IMAGE_HINT = 'docker.io/assistos/bwrap-runner@sha256:9b6c08cf78fd0a29acfbe2e45ea2ee26efe6fde49c7f3db8b3aadfa30f2d53f8';
export const PYTHON_MAJOR_MINOR = '3.12';
export const TMP_PREFIX = '.tmp-';
const RUNTIME_COMPATIBILITY = Object.freeze({
    runnerImage: RUNNER_IMAGE_HINT,
    runnerAbi: RUNNER_ABI,
    procMinimum: RUNNER_PROC_MINIMUM,
    pythonMajorMinor: PYTHON_MAJOR_MINOR,
});
const COMPATIBILITY_HASH = createHash('sha256')
    .update(JSON.stringify(RUNTIME_COMPATIBILITY)).digest('hex').slice(0, 16);
export const BUNDLE_LAYOUT_VERSION = `${BUNDLE_VERSION}-runner-abi-${RUNNER_ABI}-python-${PYTHON_MAJOR_MINOR}-${COMPATIBILITY_HASH}`;
const MAX_MANIFEST_BYTES = 64 * 1024;

export function resolveRuntimeRoot(env = process.env) {
    const candidate = String(env.OI_RUNTIME_ROOT || env.BWRAP_RUNNER_RUNTIME_ROOT || '').trim();
    const value = candidate || DEFAULT_RUNTIME_ROOT;
    if (!path.isAbsolute(value)) {
        throw new Error(`OI_RUNTIME_ROOT must be an absolute path; got ${value}`);
    }
    return path.posix.normalize(value);
}

export function bundleDir(runtimeRoot) {
    return path.join(runtimeRoot, BUNDLE_ID, BUNDLE_LAYOUT_VERSION);
}

export function bundleParentDir(runtimeRoot) {
    return path.join(runtimeRoot, BUNDLE_ID);
}

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isInsideRoot(realRoot, realPath) {
    const relative = path.relative(realRoot, realPath);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function parseRuntimeManifest(manifestPath) {
    const stat = fs.statSync(manifestPath);
    if (!stat.isFile() || stat.size > MAX_MANIFEST_BYTES) {
        return null;
    }
    const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (!isPlainObject(parsed)) {
        return null;
    }
    if (parsed.schema !== SCHEMA || parsed.id !== BUNDLE_ID || parsed.version !== BUNDLE_VERSION) {
        return null;
    }
    if (!isPlainObject(parsed.compatibility)
        || parsed.compatibility.runnerAbi !== RUNNER_ABI
        || parsed.compatibility.procMinimum !== RUNNER_PROC_MINIMUM
        || parsed.compatibility.runnerImage !== RUNNER_IMAGE_HINT
        || parsed.compatibility.pythonMajorMinor !== PYTHON_MAJOR_MINOR) {
        return null;
    }
    return parsed;
}

export function resolvePreparedRuntime(runtimeRoot) {
    let realRoot;
    try {
        realRoot = fs.realpathSync(runtimeRoot);
    } catch {
        return null;
    }
    let realRootStat;
    try {
        realRootStat = fs.statSync(realRoot);
    } catch {
        return null;
    }
    if (!realRootStat.isDirectory()) {
        return null;
    }

    const target = bundleDir(runtimeRoot);
    let realBundleDir;
    try {
        realBundleDir = fs.realpathSync(target);
    } catch {
        return null;
    }
    if (!isInsideRoot(realRoot, realBundleDir)) {
        return null;
    }
    let bundleStat;
    try {
        bundleStat = fs.statSync(realBundleDir);
    } catch {
        return null;
    }
    if (!bundleStat.isDirectory()) {
        return null;
    }

    const manifestPath = path.join(realBundleDir, 'manifest.json');
    let realManifestPath;
    try {
        realManifestPath = fs.realpathSync(manifestPath);
    } catch {
        return null;
    }
    if (!isInsideRoot(realBundleDir, realManifestPath)) {
        return null;
    }
    try {
        const manifest = parseRuntimeManifest(realManifestPath);
        if (!manifest) {
            return null;
        }
        return {
            runtimeRoot: realRoot,
            bundleDir: realBundleDir,
            manifestPath: realManifestPath,
            manifest,
        };
    } catch {
        return null;
    }
}

export function buildManifest({ digest = null, shim = null } = {}) {
    const manifest = {
        schema: SCHEMA,
        id: BUNDLE_ID,
        version: BUNDLE_VERSION,
        entrypoints: {
            default: `/runtime/bin/${SHIM_NAME}`,
        },
        python: {
            pythonPath: ['/runtime/python'],
        },
        compatibility: { ...RUNTIME_COMPATIBILITY },
    };
    if (shim) {
        manifest.shim = shim;
    }
    if (digest) {
        manifest.digest = digest;
    }
    return manifest;
}

export function readExistingManifest(runtimeRoot) {
    return resolvePreparedRuntime(runtimeRoot)?.manifest || null;
}

export function naturalLanguageBundleStatus(runtimeRoot, manifest) {
    const dir = bundleDir(runtimeRoot);
    if (!manifest) {
        return `Open Interpreter runtime bundle is not yet prepared under ${dir}.`;
    }
    return `Open Interpreter runtime bundle ${BUNDLE_ID}@${BUNDLE_VERSION} is ready at ${dir}.`;
}

export function describeBundleInput() {
    return {
        id: BUNDLE_ID,
        version: BUNDLE_VERSION,
        runnerAbi: RUNNER_ABI,
        procMinimum: RUNNER_PROC_MINIMUM,
    };
}

export function decodeResourceContent(resource) {
    if (!resource || typeof resource !== 'object') return Buffer.alloc(0);
    if (typeof resource.content === 'string') {
        const encoding = String(resource.encoding || 'utf8').toLowerCase();
        if (encoding === 'base64') {
            return Buffer.from(resource.content, 'base64');
        }
        return Buffer.from(resource.content, 'utf8');
    }
    return Buffer.alloc(0);
}
