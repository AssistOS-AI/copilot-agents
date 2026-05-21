export async function detectLoginRequired({ page }) {
    if (!page) return false;
    try {
        const url = page.url();
        const hasLoginButton = await page.locator(
            'button:has-text("Sign In"), a:has-text("Sign In"), button:has-text("Log In"), a:has-text("Log In")',
        ).count().catch(() => 0);
        const isAuthPage = url.includes('/sign-in')
            || url.includes('/login')
            || url.includes('auth.perplexity');
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
            'textarea[placeholder*="Ask"], textarea[placeholder*="ask"], div[contenteditable="true"]',
        ).first();
        await composer.waitFor({ state: 'visible', timeout: 15000 });
        await composer.click();
        await page.keyboard.type(prompt);

        const sendButton = page.locator(
            'button[aria-label="Submit"], button[aria-label="Ask"], button svg[data-icon="arrow-right"]',
        ).first();
        const sendCount = await sendButton.count().catch(() => 0);
        if (sendCount > 0) {
            await sendButton.click();
        } else {
            await page.keyboard.press('Enter');
        }

        await page.waitForTimeout(3000);

        const responseSelector = '[class*="prose"], [class*="answer"], [class*="response"], [data-testid*="answer"]';
        await page.waitForSelector(responseSelector, { timeout: effectiveTimeout });

        await waitForResponseComplete(page, effectiveTimeout);

        const answer = await extractLastResponse(page);
        if (!answer) {
            return {
                ok: false,
                final_answer: '',
                error: 'Perplexity response extraction returned empty. Selectors may need updating.',
            };
        }
        return { ok: true, final_answer: answer };
    } catch (err) {
        return {
            ok: false,
            final_answer: '',
            error: `Perplexity task failed: ${err.message}. Selectors may need updating for the current Perplexity UI.`,
        };
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
            'button[aria-label*="Stop"], [class*="loading"], [class*="streaming"]',
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
            '[class*="prose"], [class*="answer"], [class*="response"], [data-testid*="answer"]',
        ).all();
        if (messages.length === 0) return '';
        const last = messages[messages.length - 1];
        const text = await last.innerText();
        return text.trim();
    } catch {
        return '';
    }
}
