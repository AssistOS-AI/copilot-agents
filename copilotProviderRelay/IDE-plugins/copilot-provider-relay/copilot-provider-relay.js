export class CopilotProviderRelay {
    constructor(element, invalidate) {
        this.element = element;
        this.invalidate = invalidate;
        this.invalidate();
    }

    beforeRender() {}

    afterRender() {}

    afterUnload() {}

    updateHostContext() {}
}
