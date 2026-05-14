import { getWorkspaceRoot } from "/explorer/utils/workspaceRoot.js";

const RESEARCH_RELAY_AGENT = 'researchRelay';
const RESEARCH_RELAY_SUBMIT_TOOL = 'research_task_submit';
const RESEARCH_RELAY_LIST_TOOL = 'research_relay_list_backends';
const RESEARCH_RELAY_TAGS = 'open-interpreter,oi';

function normalize(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeRoot(value) {
    const normalized = normalize(value).replace(/\/+$/g, '');
    return normalized === '/' ? '' : normalized;
}

function toWorkspaceRelativeParam(fsPath, workspaceRoot) {
    const root = normalizeRoot(workspaceRoot);
    const raw = normalize(fsPath);
    if (!root || !raw || (raw !== root && !raw.startsWith(`${root}/`))) {
        return '';
    }
    const relative = raw.slice(root.length).replace(/^\/+/, '');
    if (relative.includes('\0') || relative.split('/').some((segment) => segment === '..')) {
        return '';
    }
    return relative || '.';
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
            id: 'research-relay:open-here',
            label: 'Open Research Relay here',
            icon: (plugin && plugin.icon) || '',
            action: 'open-research-relay-here'
        }
    ];
}

export async function executeMenuAction({ action, context }) {
    const selectedFsPath = normalize(context && context.selectedFsPath);
    const currentFsPath = normalize(context && context.currentFsPath);
    const workingDir = context && context.isDirectory ? selectedFsPath : (currentFsPath || selectedFsPath);
    if (!workingDir) {
        throw new Error('Missing filesystem context for Research Relay launch.');
    }
    if (action === 'open-research-relay-here') {
        const workspaceRoot = getWorkspaceRoot({
            rootHint: normalize(context && (context.workspaceRoot || context.workspaceFsRoot))
        });
        const relativeDir = toWorkspaceRelativeParam(workingDir, workspaceRoot);
        const url = buildUrl('achilles-cli', {
            'workspace-dir': relativeDir,
            'research-tags': '1',
            'forward-envelope': '1',
            'tag-relay-agent': RESEARCH_RELAY_AGENT,
            'tag-relay-submit-tool': RESEARCH_RELAY_SUBMIT_TOOL,
            'tag-relay-list-tool': RESEARCH_RELAY_LIST_TOOL,
            'tag-relay-tags': RESEARCH_RELAY_TAGS
        });
        window.open(url, '_blank', 'noopener,noreferrer');
        return;
    }
}
