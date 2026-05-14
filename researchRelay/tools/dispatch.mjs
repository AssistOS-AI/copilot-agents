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

function toWorkspaceRelative(value, workspaceRoot) {
    if (!value || !workspaceRoot) {
        return '';
    }
    const relative = path.relative(path.resolve(workspaceRoot), path.resolve(value));
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
        return '';
    }
    return relative || '.';
}

function buildRelayLaunchPath(workingDir, skillRoot, workspaceRoot, backend) {
    const relayTags = backend && Array.isArray(backend.tags) ? backend.tags.join(',') : '';
    const params = new URLSearchParams({
        agent: 'achilles-cli',
        'research-tags': '1',
        'forward-envelope': '1',
        'tag-relay-agent': 'researchRelay',
        'tag-relay-submit-tool': 'research_task_submit',
        'tag-relay-list-tool': 'research_relay_list_backends',
    });
    if (relayTags) {
        params.set('tag-relay-tags', relayTags);
    }
    const relativeWorkingDir = toWorkspaceRelative(workingDir, workspaceRoot);
    if (relativeWorkingDir) {
        params.set('workspace-dir', relativeWorkingDir);
    }
    const relativeSkillRoot = toWorkspaceRelative(skillRoot, workspaceRoot);
    if (relativeSkillRoot) {
        params.set('workspace-skill-root', relativeSkillRoot);
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
            agent: 'researchRelay',
            tag: `@${backend.tags[0]}`,
            launch_url: buildRelayLaunchPath(dir.value, skill.value, process.env.PLOINKY_WORKSPACE_ROOT, backend),
            relay_url: buildRelayLaunchPath(dir.value, skill.value, process.env.PLOINKY_WORKSPACE_ROOT, backend),
            default_profile: backend.default_profile,
            note: 'Research backends are invoked by @tag from Copilot chat; direct backend WebChat launch is deprecated.',
        });
    } catch (error) {
        writeError(error && error.message ? error.message : 'research_relay_dispatch failed');
    }
}

main();
