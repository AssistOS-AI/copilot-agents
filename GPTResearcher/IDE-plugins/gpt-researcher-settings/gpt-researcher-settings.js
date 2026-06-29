export class GPTResearcherSettings {
    constructor(element, invalidate) {
        this.element = element;
        this.invalidate = invalidate;
        this.invalidate();
    }

    beforeRender() {}

    afterRender() {}

    openSettings() {
        if (globalThis.assistOS?.UI?.showModal) {
            globalThis.assistOS.UI.showModal('gpt-researcher-settings-modal', {});
        }
    }
}
