import { getWorkspaceRoot } from "/explorer/utils/workspaceRoot.js";

function normalize(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function buildSkillRootHint(workspaceRoot) {
    if (!workspaceRoot) {
        return '';
    }
    return `${workspaceRoot.replace(/\/$/, '')}/.ploinky/repos/copilot-agents/achilles-skills`;
}

function buildUrl(agent, params) {
    const search = new URLSearchParams({ agent });
    for (const [key, value] of Object.entries(params || {})) {
        if (value) {
            search.set(key, value);
        }
    }
    return `/webchat?${search.toString()}`;
}

export async function getMenuItems({ context, plugin }) {
    const selectedFsPath = normalize(context && context.selectedFsPath);
    const currentFsPath = normalize(context && context.currentFsPath);
    const target = context && context.isDirectory ? selectedFsPath : (currentFsPath || selectedFsPath);
    if (!target) {
        return [];
    }
    return [
        {
            id: 'research-copilot:open-here',
            label: 'Open Research Copilot here',
            icon: (plugin && plugin.icon) || '',
            action: 'open-research-copilot-here'
        },
        {
            id: 'research-copilot:open-open-interpreter',
            label: 'Open Open Interpreter agent here',
            icon: (plugin && plugin.icon) || '',
            action: 'open-open-interpreter-here'
        }
    ];
}

export async function executeMenuAction({ action, context }) {
    const selectedFsPath = normalize(context && context.selectedFsPath);
    const currentFsPath = normalize(context && context.currentFsPath);
    const workingDir = context && context.isDirectory ? selectedFsPath : (currentFsPath || selectedFsPath);
    if (!workingDir) {
        throw new Error('Missing filesystem context for Research Copilot launch.');
    }
    const workspaceRoot = getWorkspaceRoot({
        rootHint: normalize(context && (context.workspaceRoot || context.workspaceFsRoot))
    });
    const skillRoot = buildSkillRootHint(workspaceRoot);

    if (action === 'open-research-copilot-here') {
        const url = buildUrl('achilles-cli', { dir: workingDir, 'skill-root': skillRoot });
        window.open(url, '_blank', 'noopener,noreferrer');
        return;
    }
    if (action === 'open-open-interpreter-here') {
        const url = buildUrl('openInterpreterAgent', { dir: workingDir });
        window.open(url, '_blank', 'noopener,noreferrer');
    }
}
