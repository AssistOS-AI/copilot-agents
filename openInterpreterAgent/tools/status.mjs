#!/usr/bin/env node
// Report runtime readiness, configured model topology, local sandbox health,
// and telemetry posture. The agent runs Open Interpreter inside its own
// container's local bwrap sandbox; status surfaces the local runner
// availability and the runtime preparation state.

import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

import { readEnvelope, writeOk, writeError } from './lib/envelope.mjs';
import {
    BUNDLE_ID,
    BUNDLE_VERSION,
    bundleDir,
    readExistingManifest,
    resolveRuntimeRoot,
} from './lib/runtime-bundle.mjs';

const LOCAL_RUNNER_BIN = process.env.OI_LOCAL_RUNNER_BIN || '/usr/local/bin/bwrap-sandbox-exec';
const LOCAL_RUNNER_FALLBACK = '/opt/bwrap-runner/bin/sandbox-exec.mjs';
const BWRAP_PATH = '/usr/bin/bwrap';

function addOptionalRoBind(args, hostPath) {
    if (fs.existsSync(hostPath)) {
        args.push('--ro-bind', hostPath, hostPath);
    }
}

function bool(name, defaultValue) {
    const raw = process.env[name];
    if (raw == null || raw === '') return defaultValue;
    return ['1', 'true', 'yes', 'on', 'y'].includes(String(raw).toLowerCase());
}

function probeLocalSandbox() {
    const runnerPath = fs.existsSync(LOCAL_RUNNER_BIN)
        ? LOCAL_RUNNER_BIN
        : (fs.existsSync(LOCAL_RUNNER_FALLBACK) ? LOCAL_RUNNER_FALLBACK : null);
    if (!runnerPath) {
        return {
            runner_path: null,
            runner_available: false,
            bwrap_available: fs.existsSync(BWRAP_PATH),
            reason: `local sandbox runner not installed at ${LOCAL_RUNNER_BIN} or ${LOCAL_RUNNER_FALLBACK}`,
        };
    }
    const bwrapAvailable = fs.existsSync(BWRAP_PATH);
    if (!bwrapAvailable) {
        return {
            runner_path: runnerPath,
            runner_available: true,
            bwrap_available: false,
            reason: `bubblewrap binary not present at ${BWRAP_PATH}`,
        };
    }
    const args = [
        '--die-with-parent',
        '--unshare-user', '--unshare-pid', '--unshare-ipc', '--unshare-uts', '--unshare-net',
        '--clearenv',
        '--setenv', 'PATH', '/usr/bin:/bin',
        '--ro-bind', '/usr', '/usr',
    ];
    addOptionalRoBind(args, '/lib');
    addOptionalRoBind(args, '/lib64');
    addOptionalRoBind(args, '/bin');
    args.push(
        '--proc', '/proc',
        '--dev', '/dev',
        '--tmpfs', '/tmp',
        '--', '/usr/bin/env', '-i', 'PATH=/usr/bin:/bin', '/bin/sh', '-c', 'echo bwrap-nested-ok',
    );
    const probe = spawnSync(BWRAP_PATH, args, { encoding: 'utf8', timeout: 5000 });
    if (probe.error) {
        return {
            runner_path: runnerPath,
            runner_available: true,
            bwrap_available: true,
            nested_namespace_ok: false,
            reason: `nested bwrap probe failed to spawn: ${probe.error.message || probe.error}`,
        };
    }
    if (probe.status === 0 && String(probe.stdout || '').trim() === 'bwrap-nested-ok') {
        return {
            runner_path: runnerPath,
            runner_available: true,
            bwrap_available: true,
            nested_namespace_ok: true,
        };
    }
    return {
        runner_path: runnerPath,
        runner_available: true,
        bwrap_available: true,
        nested_namespace_ok: false,
        reason: String(probe.stderr || '').trim()
            || `nested bwrap probe exited ${probe.status} with output ${String(probe.stdout || '').trim() || '<empty>'}`,
    };
}

async function main() {
    try {
        await readEnvelope();
        const runtimeRoot = resolveRuntimeRoot(process.env);
        const manifest = readExistingManifest(runtimeRoot);
        writeOk({
            agent: 'openInterpreterAgent',
            mode: 'provider',
            runtime: {
                root: runtimeRoot,
                bundleId: BUNDLE_ID,
                bundleVersion: BUNDLE_VERSION,
                bundleDir: bundleDir(runtimeRoot),
                prepared: Boolean(manifest),
                manifest,
            },
            sandbox: probeLocalSandbox(),
            config: {
                model: process.env.OPEN_INTERPRETER_MODEL || null,
                api_base: process.env.OPEN_INTERPRETER_API_BASE || null,
                offline: bool('OPEN_INTERPRETER_OFFLINE', true),
                local_endpoint: process.env.OPEN_INTERPRETER_LOCAL || null,
            },
            telemetry: {
                disabled: bool('DISABLE_TELEMETRY', true),
                anonymized_disabled: !bool('ANONYMIZED_TELEMETRY', false),
            },
            paths: {
                workspaceRoot: process.env.PLOINKY_WORKSPACE_ROOT || null,
                dataRoot: '/data',
            },
        });
    } catch (error) {
        writeError(error && error.message ? error.message : 'oi_status failed');
    }
}

main();
