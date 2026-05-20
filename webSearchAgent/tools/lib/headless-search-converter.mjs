const SELECTORS = Object.freeze({
    aiAnswerContainer: '[data-ai-answer], .XDKMoc, div[jsname="WbKHeb"], div[jsname="H7tCnf"], .QGG6Id.YNk70c, .bzXtMb',
    aiAnswerParagraphs: '.n6owBd.awi2gc, span.T286Pc, p, span.hgKElc, div > span',
    citationLinks: 'a[href][data-ved], a.KEVENd, a.cz3goc',
    captchaIndicator: '#captcha-form, form[action*="/sorry"]',
    organicResults: 'div.g, div.tF2Cxc',
    organicTitle: 'h3',
    organicLink: 'a[href]',
    organicSnippet: 'div.VwiC3b, span.aCOpRe',
});

export async function extractGoogleAiModeResults(page, settings = {}) {
    const selectors = settings.custom_selectors
        ? { ...SELECTORS, ...settings.custom_selectors }
        : SELECTORS;
    const timeoutMs = settings.browser_timeout_ms || 30000;

    const currentUrl = page.url();
    if (currentUrl.includes('/sorry/') || currentUrl.includes('/sorry?')) {
        const error = new Error('Google CAPTCHA detected');
        error.captchaDetected = true;
        throw error;
    }

    const captcha = await page.$(selectors.captchaIndicator);
    if (captcha) {
        const error = new Error('Google CAPTCHA detected');
        error.captchaDetected = true;
        throw error;
    }

    let aiContainer = null;
    try {
        aiContainer = await page.waitForSelector(selectors.aiAnswerContainer, { timeout: timeoutMs });
    } catch {
        // AI answer not found; fall back to ordinary search results.
    }

    if (!aiContainer) {
        return extractOrganicResults(page, selectors);
    }

    const answer = await aiContainer.evaluate((el, pSelector) => {
        const isUiText = (text) => [
            /vil du slette/i,
            /tidsbesparende/i,
            /din feedback/i,
            /google anvender/i,
            /opretter et offentligt link/i,
            /tak, fordi/i,
            /du er logget ud/i,
            /historik for ai/i,
            /this response uses data provided/i,
        ].some((pattern) => pattern.test(text));
        const paragraphs = el.querySelectorAll(pSelector);
        if (paragraphs.length > 0) {
            return Array.from(paragraphs)
                .filter((p) => {
                    if (p.closest('script, style, [role="dialog"], #fbproxy3')) return false;
                    const aria = p.getAttribute('aria-label') || '';
                    if (/feedback|historik|history/i.test(aria)) return false;
                    return true;
                })
                .map((p) => p.textContent.trim())
                .filter(Boolean)
                .filter((text) => !isUiText(text))
                .join('\n\n');
        }
        return el.textContent.trim();
    }, selectors.aiAnswerParagraphs);

    const citations = await page.evaluate((linkSelector) => {
        const links = document.querySelectorAll(linkSelector);
        const seen = new Set();
        const results = [];
        for (const a of links) {
            const href = a.href;
            if (!href || href.startsWith('javascript:') || seen.has(href)) continue;
            if (href.includes('google.com/search')) continue;
            seen.add(href);
            results.push({
                title: a.textContent.trim() || a.getAttribute('aria-label') || href,
                url: href,
            });
        }
        return results;
    }, selectors.citationLinks);

    return { answer, citations };
}

export function formatAiModeResponse(answer, citations, query) {
    if (!answer && citations.length === 0) {
        return `No results found for: "${query}"`;
    }

    const displayAnswer = stripLeadingQuery(answer, query);
    const lines = [`**Search results for:** "${query}"\n`];

    if (displayAnswer) {
        lines.push(displayAnswer);
        lines.push('');
    }

    if (citations.length > 0) {
        lines.push('---');
        lines.push('**Sources:**');
        for (let i = 0; i < citations.length; i += 1) {
            const citation = citations[i];
            lines.push(`[${i + 1}] [${citation.title}](${citation.url})`);
        }
    }

    return lines.join('\n');
}

async function extractOrganicResults(page, selectors) {
    const results = await page.evaluate(
        (containerSel, titleSel, linkSel, snippetSel) => {
            const items = document.querySelectorAll(containerSel);
            const out = [];
            for (const item of items) {
                const titleEl = item.querySelector(titleSel);
                const linkEl = item.querySelector(linkSel);
                const snippetEl = item.querySelector(snippetSel);
                if (!titleEl || !linkEl) continue;
                out.push({
                    title: titleEl.textContent.trim(),
                    url: linkEl.href,
                    snippet: snippetEl?.textContent?.trim() || '',
                });
            }
            return out;
        },
        selectors.organicResults,
        selectors.organicTitle,
        selectors.organicLink,
        selectors.organicSnippet,
    );

    if (results.length === 0) return { answer: '', citations: [] };

    const lines = results.map((result, index) => (
        `${index + 1}. **${result.title}**\n   ${result.url}\n   ${result.snippet}`
    ));
    return {
        answer: lines.join('\n\n'),
        citations: results.map((result) => ({
            title: result.title,
            url: result.url,
        })),
    };
}

function stripLeadingQuery(answer, query) {
    if (!answer || !query) return answer;
    const lines = answer.split('\n');
    while (lines.length > 0 && !lines[0].trim()) {
        lines.shift();
    }
    if (lines.length > 0 && lines[0].trim().toLowerCase() === query.trim().toLowerCase()) {
        lines.shift();
    }
    return lines.join('\n').trim();
}
