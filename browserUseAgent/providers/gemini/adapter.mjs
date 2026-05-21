export async function detectLoginRequired({ page }) {
    if (!page) return false;
    try {
        const url = page.url();
        const hasSignInButton = await page.locator(
            'a:has-text("Sign in"), button:has-text("Sign in"), a[href*="accounts.google.com"]',
        ).count().catch(() => 0);
        const isAuthPage = url.includes('accounts.google.com')
            || url.includes('/signin/')
            || url.includes('/ServiceLogin');
        return hasSignInButton > 0 || isAuthPage;
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
            'rich-textarea [contenteditable="true"], div[contenteditable="true"][aria-label*="Enter"], textarea',
        ).first();
        await composer.waitFor({ state: 'visible', timeout: 15000 });
        await composer.click();
        await page.keyboard.type(prompt);
        await page.keyboard.press('Enter');

        await page.waitForTimeout(3000);

        const responseSelector = 'message-content, .model-response-text, response-container, [data-response-index]';
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
            'button[aria-label*="Stop"], mat-progress-bar, .loading',
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
            'message-content, .model-response-text, response-container, [data-response-index]',
        ).all();
        if (messages.length === 0) return '';
        const last = messages[messages.length - 1];
        const text = await last.innerText();
        return text.trim();
    } catch {
        return '';
    }
}
