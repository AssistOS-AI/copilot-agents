export async function detectLoginRequired({ page }) {
    if (!page) return false;
    try {
        const url = page.url();
        const hasLoginButton = await page.locator(
            'button:has-text("Log in"), a:has-text("Log in"), [data-testid="login-button"]',
        ).count().catch(() => 0);
        const isAuthPage = url.includes('auth0.com')
            || url.includes('/auth/login')
            || url.includes('login.openai.com');
        return hasLoginButton > 0 || isAuthPage;
    } catch {
        return false;
    }
}

export async function submitPrompt({ page, prompt, timeoutMs }) {
    if (!page) {
        return { ok: false, final_answer: '', error: 'no active page' };
    }

    const effectiveTimeout = timeoutMs || 120000;

    try {
        const composer = page.locator(
            '#prompt-textarea, [contenteditable="true"][data-placeholder], textarea[placeholder*="Message"]',
        ).first();
        await composer.waitFor({ state: 'visible', timeout: 15000 });
        await composer.click();
        await composer.fill(prompt);

        const sendButton = page.locator(
            'button[data-testid="send-button"], button[aria-label="Send prompt"]',
        ).first();
        await sendButton.click();

        await page.waitForTimeout(3000);

        const responseSelector = '[data-message-author-role="assistant"]:last-of-type, .agent-turn:last-of-type .markdown';
        await page.waitForSelector(responseSelector, { timeout: effectiveTimeout });

        await waitForResponseComplete(page, effectiveTimeout);

        const answer = await extractLastResponse(page);
        return { ok: true, final_answer: answer };
    } catch (err) {
        return { ok: false, final_answer: '', error: `Task execution failed: ${err.message}` };
    }
}

async function waitForResponseComplete(page, maxWait = 120000) {
    const pollInterval = 2000;
    let elapsed = 0;
    let previousText = '';

    while (elapsed < maxWait) {
        await page.waitForTimeout(pollInterval);
        elapsed += pollInterval;

        const currentText = await extractLastResponse(page);
        const stillStreaming = await page.locator(
            'button[aria-label="Stop generating"], .result-streaming',
        ).count().catch(() => 0);

        if (stillStreaming === 0 && currentText === previousText && currentText.length > 0) {
            break;
        }
        previousText = currentText;
    }
}

async function extractLastResponse(page) {
    try {
        const messages = await page.locator(
            '[data-message-author-role="assistant"]',
        ).all();
        if (messages.length === 0) return '';
        const last = messages[messages.length - 1];
        const text = await last.innerText();
        return text.trim();
    } catch {
        return '';
    }
}
