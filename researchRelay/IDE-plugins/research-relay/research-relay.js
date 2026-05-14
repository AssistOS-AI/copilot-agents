import { getWorkspaceRoot } from "/explorer/utils/workspaceRoot.js";

const RESEARCH_RELAY_AGENT = 'researchRelay';
const RESEARCH_RELAY_SUBMIT_TOOL = 'research_task_submit';
const RESEARCH_RELAY_LIST_TOOL = 'research_relay_list_backends';
const RESEARCH_RELAY_TAGS = 'open-interpreter,oi';

function normalizeRoot(value) {
    const normalized = typeof value === 'string' ? value.trim().replace(/\/+$/g, '') : '';
    return normalized === '/' ? '' : normalized;
}

function toWorkspaceFsPath(explorerPath, workspaceRoot) {
    const raw = typeof explorerPath === 'string' ? explorerPath.trim() : '';
    const root = normalizeRoot(workspaceRoot);
    if (!raw) {
        return root;
    }
    if (!root || raw.startsWith(root)) {
        return raw;
    }
    if (raw === '/') {
        return root;
    }
    if (raw.startsWith('/')) {
        return `${root}${raw}`;
    }
    return `${root}/${raw}`;
}

function toWorkspaceRelativeParam(fsPath, workspaceRoot) {
    const root = normalizeRoot(workspaceRoot);
    const raw = typeof fsPath === 'string' ? fsPath.trim() : '';
    if (!root || !raw || (raw !== root && !raw.startsWith(`${root}/`))) {
        return '';
    }
    const relative = raw.slice(root.length).replace(/^\/+/, '');
    if (relative.includes('\0') || relative.split('/').some((segment) => segment === '..')) {
        return '';
    }
    return relative || '.';
}

async function callMcp(agent, toolName, payload) {
    const services = window.webSkel?.appServices || window.assistOS?.appServices;
    if (!services || typeof services.callTool !== 'function') {
        throw new Error('Explorer appServices.callTool is not available');
    }
    const response = await services.callTool(agent, toolName, payload || {});
    if (response && typeof response === 'object' && response.json !== undefined) {
        return response.json;
    }
    if (response && typeof response.text === 'string') {
        try {
            return JSON.parse(response.text);
        } catch {
            return response;
        }
    }
    return response;
}

export class ResearchRelay {
    constructor(element, invalidate) {
        this.element = element;
        this.invalidate = invalidate;
        this.hostContext = {};
        this.invalidate();
    }

    beforeRender() {}

    afterRender() {
        this.button = this.element.querySelector('#researchRelayButton');
        this.statusEl = this.element.querySelector('.research-relay-button-status');
        this.refreshStatus();
    }

    afterUnload() {}

    updateHostContext(context = {}) {
        this.hostContext = context;
    }

    async refreshStatus() {
        if (!this.statusEl) {
            return;
        }
        this.statusEl.textContent = '...';
        this.statusEl.dataset.state = 'pending';
        try {
            const response = await callMcp(RESEARCH_RELAY_AGENT, 'research_relay_status', {});
            const result = response && response.result ? response.result : response;
            const bwrapReachable = Boolean(result?.execution?.bwrap?.reachable);
            const configured = Array.isArray(result && result.backends)
                ? result.backends.filter((backend) => backend && backend.configured).length
                : 0;
            this.statusEl.textContent = bwrapReachable ? `relay ${configured}` : 'setup';
            this.statusEl.dataset.state = bwrapReachable ? 'ok' : 'error';
        } catch (error) {
            this.statusEl.textContent = 'offline';
            this.statusEl.dataset.state = 'error';
        }
    }

    async openLaunchers() {
        const workspaceRoot = getWorkspaceRoot({
            rootHint: this.hostContext.workspaceRoot || this.hostContext.workspaceFsRoot || ''
        });
        const dir = this.hostContext.currentFsPath
            || this.hostContext.workspaceFsRoot
            || toWorkspaceFsPath(this.hostContext.currentPath || '/', workspaceRoot);
        const params = new URLSearchParams({
            agent: 'achilles-cli',
            'research-tags': '1',
            'forward-envelope': '1',
            'tag-relay-agent': RESEARCH_RELAY_AGENT,
            'tag-relay-submit-tool': RESEARCH_RELAY_SUBMIT_TOOL,
            'tag-relay-list-tool': RESEARCH_RELAY_LIST_TOOL,
            'tag-relay-tags': RESEARCH_RELAY_TAGS
        });
        const relativeDir = toWorkspaceRelativeParam(dir, workspaceRoot);
        if (relativeDir) {
            params.set('workspace-dir', relativeDir);
        }
        window.open(`/webchat?${params.toString()}`, '_blank', 'noopener,noreferrer');
    }
}
