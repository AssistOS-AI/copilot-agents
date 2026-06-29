const DEFAULTS = Object.freeze({
    provider: 'duckduckgo',
    maxResults: 8,
    searxngUrl: '',
});

const PROVIDER_HINTS = Object.freeze({
    duckduckgo: 'Zero-config default. No API key is required.',
    tavily: 'Requires TAVILY_API_KEY in the agent environment.',
    serper: 'Requires SERPER_API_KEY in the agent environment.',
    google: 'Requires GOOGLE_API_KEY and GOOGLE_CSE_ID in the agent environment.',
    bing: 'Requires BING_API_KEY in the agent environment.',
    searxng: 'Requires a SearXNG instance URL.',
});

function normalizeProvider(value) {
    return Object.hasOwn(PROVIDER_HINTS, value) ? value : DEFAULTS.provider;
}

function clampInteger(value, fallback, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, Math.floor(number)));
}

export class GPTResearcherSettingsModal {
    constructor(element, invalidate) {
        this.element = element;
        this.invalidate = invalidate;
        this.state = { ...DEFAULTS };
        this.invalidate();
    }

    beforeRender() {}

    afterRender() {
        this.cacheElements();
        this.bindEvents();
        this.loadSettings();
    }

    cacheElements() {
        this.providerSelect = this.element.querySelector('#gptResearcherProvider');
        this.maxResultsInput = this.element.querySelector('#gptResearcherMaxResults');
        this.searxngWrap = this.element.querySelector('#gptResearcherSearxngWrap');
        this.searxngInput = this.element.querySelector('#gptResearcherSearxngUrl');
        this.hint = this.element.querySelector('#gptResearcherProviderHint');
        this.status = this.element.querySelector('#gptResearcherStatus');
    }

    bindEvents() {
        if (this.element.dataset.gptResearcherSettingsBound === 'true') return;
        this.element.dataset.gptResearcherSettingsBound = 'true';
        this.providerSelect?.addEventListener('change', () => {
            this.state.provider = normalizeProvider(this.providerSelect.value);
            this.render();
        });
    }

    loadSettings() {
        this.setStatus('', false);
        this.render();
    }

    async saveSettings() {
        const settings = {
            provider: normalizeProvider(this.providerSelect?.value),
            maxResults: clampInteger(this.maxResultsInput?.value, DEFAULTS.maxResults, 1, 20),
            searxngUrl: String(this.searxngInput?.value || '').trim(),
        };
        try {
            const client = await this.ensureMcpClient();
            const result = await client.callTool('gpt_researcher_update_settings', settings);
            const payload = decodeToolPayload(result);
            if (payload.ok === false) {
                throw new Error(payload.error || 'Failed to save settings.');
            }
            this.state = { ...DEFAULTS, ...settings };
            this.setStatus('Settings saved in gpt-researcher-settings.json.', false);
        } catch (error) {
            this.setStatus(`Failed to save settings: ${error.message}`, true);
        }
        this.render();
    }

    async ensureMcpClient() {
        if (this.mcpClient) return this.mcpClient;
        const module = await import('/MCPBrowserClient.js');
        if (!module || typeof module.createAgentClient !== 'function') {
            throw new Error('MCP browser client module is unavailable.');
        }
        this.mcpClient = module.createAgentClient('/GPTResearcher/mcp');
        return this.mcpClient;
    }

    render() {
        const provider = normalizeProvider(this.state.provider);
        if (this.providerSelect) this.providerSelect.value = provider;
        if (this.maxResultsInput) this.maxResultsInput.value = this.state.maxResults;
        if (this.searxngInput) this.searxngInput.value = this.state.searxngUrl || '';
        if (this.searxngWrap) this.searxngWrap.hidden = provider !== 'searxng';
        if (this.hint) this.hint.textContent = PROVIDER_HINTS[provider];
    }

    setStatus(message, isError) {
        if (!this.status) return;
        this.status.textContent = message || '';
        this.status.classList.toggle('error', Boolean(isError));
    }

    closeModal() {
        globalThis.assistOS?.UI?.closeModal?.(this.element, null);
    }
}

function decodeToolPayload(result) {
    const text = Array.isArray(result?.content)
        ? result.content
            .filter((entry) => entry?.type === 'text' && typeof entry.text === 'string')
            .map((entry) => entry.text)
            .join('\n')
            .trim()
        : typeof result === 'string'
            ? result
            : typeof result?.text === 'string'
                ? result.text
                : JSON.stringify(result || {});
    try {
        return JSON.parse(text || '{}');
    } catch {
        throw new Error(text || 'GPTResearcher settings tool returned an invalid response.');
    }
}

export class GPTResearcherSettingsModalSettings {
    constructor(...args) {
        return new GPTResearcherSettingsModal(...args);
    }
}
