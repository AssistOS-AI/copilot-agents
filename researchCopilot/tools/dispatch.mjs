#!/usr/bin/env node
import path from 'node:path';
import { readEnvelope, writeOk, writeError } from './lib/envelope.mjs';
import { findBackend } from './lib/backends.mjs';

function isSafeRelative(target, root) {
    const resolved = path.resolve(root, target);
    const relative = path.relative(root, resolved);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolveWorkingDir(candidate) {
    const root = process.env.PLOINKY_WORKSPACE_ROOT;
    if (!root) {
        return { error: 'PLOINKY_WORKSPACE_ROOT is not set' };
    }
    if (!candidate) {
        return { value: root };
    }
    if (typeof candidate !== 'string' || candidate.includes('\x00')) {
        return { error: 'working_directory is invalid' };
    }
    if (path.isAbsolute(candidate)) {
        const relative = path.relative(root, candidate);
        if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
            return { value: candidate };
        }
        return { error: 'working_directory escapes workspace root' };
    }
    if (!isSafeRelative(candidate, root)) {
        return { error: 'working_directory escapes workspace root' };
    }
    return { value: path.resolve(root, candidate) };
}

function resolveSkillRoot(candidate) {
    if (!candidate) {
        return { value: null };
    }
    if (typeof candidate !== 'string' || candidate.includes('\x00')) {
        return { error: 'skill_root is invalid' };
    }
    const root = process.env.PLOINKY_WORKSPACE_ROOT;
    if (!root) {
        return { value: candidate };
    }
    if (path.isAbsolute(candidate)) {
        const relative = path.relative(root, candidate);
        if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
            return { value: candidate };
        }
        return { error: 'skill_root escapes workspace root' };
    }
    if (!isSafeRelative(candidate, root)) {
        return { error: 'skill_root escapes workspace root' };
    }
    return { value: path.resolve(root, candidate) };
}

function buildLaunchPath(backend, workingDir, skillRoot) {
    const params = new URLSearchParams({ agent: backend.agent });
    if (workingDir) {
        params.set('dir', workingDir);
    }
    if (skillRoot) {
        params.set('skill-root', skillRoot);
    }
    return `/webchat?${params.toString()}`;
}

function buildCopilotLaunchPath(workingDir, skillRoot) {
    const params = new URLSearchParams({ agent: 'achilles-cli' });
    if (workingDir) {
        params.set('dir', workingDir);
    }
    if (skillRoot) {
        params.set('skill-root', skillRoot);
    }
    return `/webchat?${params.toString()}`;
}

async function main() {
    try {
        const envelope = await readEnvelope();
        const input = envelope.input || {};

        const backend = findBackend(input.backend);
        if (!backend) {
            writeError('backend is required and must match a known research backend id');
            return;
        }

        const dir = resolveWorkingDir(input.working_directory);
        if (dir.error) {
            writeError(dir.error);
            return;
        }
        const skill = resolveSkillRoot(input.skill_root);
        if (skill.error) {
            writeError(skill.error);
            return;
        }

        writeOk({
            backend: backend.id,
            agent: backend.agent,
            launch_url: buildLaunchPath(backend, dir.value, skill.value),
            copilot_url: buildCopilotLaunchPath(dir.value, skill.value),
            default_profile: backend.default_profile,
            note: backend.id === 'open-interpreter'
                ? 'Open Interpreter is part of the default research-agents profile.'
                : `Enable bundle profile '${backend.default_profile}' before dispatching this backend.`,
        });
    } catch (error) {
        writeError(error && error.message ? error.message : 'research_copilot_dispatch failed');
    }
}

main();
