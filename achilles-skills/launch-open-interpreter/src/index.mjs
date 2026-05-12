import fs from 'node:fs';
import path from 'node:path';

export const TARGET_AGENT = 'openInterpreterAgent';
export const BUNDLE_ENABLE_COMMAND = 'ploinky enable agent copilot-agents/research-agents global';

const NULL_CHAR = String.fromCharCode(0);

function trimOrEmpty(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function firstNonEmpty(...values) {
    for (const value of values) {
        const trimmed = trimOrEmpty(value);
        if (trimmed) {
            return trimmed;
        }
    }
    return '';
}

export function isPathSafe(candidate, workspaceRoot) {
    const target = trimOrEmpty(candidate);
    const root = trimOrEmpty(workspaceRoot);
    if (!target || target.includes(NULL_CHAR)) {
        return false;
    }
    if (!root) {
        return path.isAbsolute(target);
    }
    const resolvedRoot = path.resolve(root);
    const resolvedTarget = path.isAbsolute(target)
        ? path.resolve(target)
        : path.resolve(resolvedRoot, target);
    const relative = path.relative(resolvedRoot, resolvedTarget);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function buildLaunchUrl({ workingDir = '', workspaceRoot = '' } = {}) {
    const params = new URLSearchParams({ agent: TARGET_AGENT });
    const dir = trimOrEmpty(workingDir);
    if (dir && isPathSafe(dir, workspaceRoot)) {
        const resolved = path.isAbsolute(dir)
            ? path.resolve(dir)
            : path.resolve(trimOrEmpty(workspaceRoot) || process.cwd(), dir);
        params.set('dir', resolved);
    }
    return `/webchat?${params.toString()}`;
}

function readJsonIfPresent(filePath) {
    try {
        if (!filePath || !fs.existsSync(filePath)) {
            return null;
        }
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
        return null;
    }
}

function candidateRoutingFiles(workspaceRoot, workingDir) {
    const roots = [];
    for (const value of [workspaceRoot, workingDir, process.cwd()]) {
        const trimmed = trimOrEmpty(value);
        if (trimmed && path.isAbsolute(trimmed)) {
            roots.push(path.resolve(trimmed));
        }
    }

    const candidates = [];
    const seen = new Set();
    for (const root of roots) {
        let current = root;
        while (current && !seen.has(current)) {
            seen.add(current);
            candidates.push(path.join(current, '.ploinky', 'routing.json'));
            const parent = path.dirname(current);
            if (parent === current) {
                break;
            }
            current = parent;
        }
    }
    return candidates;
}

export function isAgentRouted(agentName, routing) {
    if (!routing || typeof routing !== 'object') {
        return false;
    }
    if (routing.static && routing.static.agent === agentName) {
        return true;
    }
    const routes = routing.routes && typeof routing.routes === 'object' ? routing.routes : {};
    return Object.prototype.hasOwnProperty.call(routes, agentName);
}

export function detectDeployment({ agentName = TARGET_AGENT, workspaceRoot = '', workingDir = '' } = {}) {
    for (const routingFile of candidateRoutingFiles(workspaceRoot, workingDir)) {
        const routing = readJsonIfPresent(routingFile);
        if (routing && isAgentRouted(agentName, routing)) {
            return { deployed: true, routingFile };
        }
    }
    return { deployed: false, routingFile: null };
}

export function describeDeployment({ deployed }) {
    if (deployed) {
        return null;
    }
    return `note: ${TARGET_AGENT} is not present in the current Ploinky routing file. Run "${BUNDLE_ENABLE_COMMAND}" and restart the workspace before opening the URL.`;
}

function resolveInvocationPaths(args = {}) {
    const context = args.context && typeof args.context === 'object' ? args.context : {};
    const workingDir = firstNonEmpty(
        args.workingDir,
        args.working_directory,
        context.workingDir,
        process.cwd()
    );
    const workspaceRoot = firstNonEmpty(
        args.workspaceRoot,
        args.workspace_root,
        context.workspaceRoot,
        process.env.PLOINKY_WORKSPACE_ROOT,
        workingDir
    );
    return { workingDir, workspaceRoot };
}

export async function action(args = {}) {
    const { workingDir, workspaceRoot } = resolveInvocationPaths(args);
    const launchUrl = buildLaunchUrl({ workingDir, workspaceRoot });
    const deployment = detectDeployment({ workspaceRoot, workingDir });
    const lines = [launchUrl];
    const note = describeDeployment(deployment);
    if (note) {
        lines.push(note);
    }
    return lines.join('\n');
}
