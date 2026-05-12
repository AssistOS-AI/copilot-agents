import { getWorkspaceRoot } from "/explorer/utils/workspaceRoot.js";

const RESEARCH_COPILOT_AGENT = 'researchCopilot';

function buildSkillRootHint(workspaceRoot) {
    if (!workspaceRoot) {
        return '';
    }
    return `${workspaceRoot.replace(/\/$/, '')}/.ploinky/repos/copilot-agents/achilles-skills`;
}

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

export class ResearchCopilot {
    constructor(element, invalidate) {
        this.element = element;
        this.invalidate = invalidate;
        this.hostContext = {};
        this.invalidate();
    }

    beforeRender() {}

    afterRender() {
        this.button = this.element.querySelector('#researchCopilotButton');
        this.statusEl = this.element.querySelector('.research-copilot-button-status');
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
            const response = await callMcp(RESEARCH_COPILOT_AGENT, 'research_copilot_status', {});
            const result = response && response.result ? response.result : response;
            const reachable = Array.isArray(result && result.backends)
                ? result.backends.filter((b) => b && b.reachable).length
                : 0;
            const total = Array.isArray(result && result.backends) ? result.backends.length : 0;
            this.statusEl.textContent = `${reachable}/${total}`;
            this.statusEl.dataset.state = reachable > 0 ? 'ok' : 'error';
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
        const skillRoot = buildSkillRootHint(workspaceRoot);
        const params = new URLSearchParams({ agent: 'achilles-cli' });
        if (dir) {
            params.set('dir', dir);
        }
        if (skillRoot) {
            params.set('skill-root', skillRoot);
        }
        window.open(`/webchat?${params.toString()}`, '_blank', 'noopener,noreferrer');
    }
}
