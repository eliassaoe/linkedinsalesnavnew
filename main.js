const { Actor } = require('apify');

Actor.main(async () => {
    const input = await Actor.getInput();
    const { linkedinCookies, profileUrl } = input;

    if (!linkedinCookies || !profileUrl) {
        throw new Error('Cookies et URL requis');
    }

    console.log('Starting LinkedIn scraping for:', profileUrl);

    // Use Apify's built-in proxy and browser
    const proxyConfiguration = await Actor.createProxyConfiguration({
        groups: ['RESIDENTIAL'],
        countryCode: 'US'
    });

    const browser = await Actor.launchPuppeteer({
        headless: true,
        proxyConfiguration,
        stealth: true,
        useChrome: true,
        launchOptions: {
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-blink-features=AutomationControlled',
                '--disable-features=VizDisplayCompositor',
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows',
                '--disable-renderer-backgrounding'
            ]
        }
    });

    const page = await browser.newPage();

    // Enhanced stealth
    await page.evaluateOnNewDocument(() => {
        // Remove webdriver property
        delete navigator.__proto__.webdriver;
        
        // Mock plugins
        Object.defineProperty(navigator, 'plugins', {
            get: () => [1, 2, 3, 4, 5]
        });
        
        // Mock languages
        Object.defineProperty(navigator, 'languages', {
            get: () => ['en-US', 'en']
        });
        
        // Mock webgl
        const getParameter = WebGLRenderingContext.getParameter;
        WebGLRenderingContext.prototype.getParameter = function(parameter) {
            if (parameter === 37445) {
                return 'Intel Inc.';
            }
            if (parameter === 37446) {
                return 'Intel Iris OpenGL Engine';
            }
            return getParameter(parameter);
        };
    });

    // Set realistic headers
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    await page.setExtraHTTPHeaders({
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Cache-Control': 'max-age=0'
    });

    // Clean and set cookies
    const cookies = Array.isArray(linkedinCookies[0]) ? linkedinCookies[0] : linkedinCookies;
    const cleanCookies = cookies.map(cookie => ({
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path || '/',
        expires: cookie.expirationDate ? Math.floor(cookie.expirationDate) : undefined,
        httpOnly: cookie.httpOnly || false,
        secure: cookie.secure || false,
        sameSite: cookie.sameSite === 'no_restriction' ? 'None' : 
                 cookie.sameSite === 'lax' ? 'Lax' : 
                 cookie.sameSite === 'strict' ? 'Strict' : 'Lax'
    }));

    await page.setCookie(...cleanCookies);
    console.log('Cookies applied:', cleanCookies.length);

    try {
        // First, visit LinkedIn homepage to establish session
        console.log('Establishing session...');
        await page.goto('https://www.linkedin.com/feed', { 
            waitUntil: 'domcontentloaded', 
            timeout: 30000 
        });
        await page.waitForTimeout(3000);

        // Check if we're logged in
        const isLoggedIn = await page.evaluate(() => {
            return !document.querySelector('.nav__button-secondary') && 
                   !window.location.href.includes('authwall');
        });

        if (!isLoggedIn) {
            console.log('Not logged in, trying direct profile access...');
        }

        // Now navigate to the profile
        console.log('Navigating to profile...');
        await page.goto(profileUrl, { 
            waitUntil: 'domcontentloaded', 
            timeout: 45000 
        });

        // Wait for content to load
        await page.waitForTimeout(8000);

        // Check for authwall
        const currentUrl = page.url();
        if (currentUrl.includes('authwall') || currentUrl.includes('login')) {
            throw new Error('LinkedIn authwall detected - cookies may be invalid');
        }

        console.log('Page loaded, extracting data...');

        // Scroll to load dynamic content
        await page.evaluate(async () => {
            const scrollDelay = ms => new Promise(resolve => setTimeout(resolve, ms));
            
            for (let i = 0; i < 3; i++) {
                window.scrollTo(0, (i + 1) * (document.body.scrollHeight / 4));
                await scrollDelay(2000);
            }
            
            window.scrollTo(0, 0);
            await scrollDelay(1000);
        });

        // Extract profile data with multiple selector strategies
        const profileData = await page.evaluate(() => {
            const data = {
                url: window.location.href,
                timestamp: new Date().toISOString(),
                scrapingSuccess: false
            };

            try {
                // Name extraction with multiple selectors
                const nameSelectors = [
                    'h1.text-heading-xlarge',
                    'h1.break-words',
                    '.pv-text-details__left-panel h1',
                    '.ph5 h1',
                    'h1'
                ];
                
                for (const selector of nameSelectors) {
                    const element = document.querySelector(selector);
                    if (element && element.textContent && 
                        !element.textContent.includes('Sign') && 
                        !element.textContent.includes('Join') &&
                        element.textContent.trim().length > 2) {
                        data.name = element.textContent.trim();
                        break;
                    }
                }

                // Title/headline
                const titleSelectors = [
                    '.text-body-medium.break-words',
                    '.pv-text-details__left-panel .text-body-medium',
                    '.ph5 .text-body-medium'
                ];
                
                for (const selector of titleSelectors) {
                    const element = document.querySelector(selector);
                    if (element && element.textContent && 
                        !element.textContent.includes('connection') && 
                        !element.textContent.includes('follower') &&
                        element.textContent.trim().length > 5) {
                        data.headline = element.textContent.trim();
                        break;
                    }
                }

                // Location
                const locationSelectors = [
                    '.text-body-small.inline.t-black--light.break-words',
                    '.pv-text-details__left-panel .text-body-small',
                    '.ph5 .text-body-small'
                ];
                
                for (const selector of locationSelectors) {
                    const element = document.querySelector(selector);
                    if (element && element.textContent && 
                        !element.textContent.includes('connection') && 
                        !element.textContent.includes('follower') &&
                        element.textContent.trim().length > 2) {
                        data.location = element.textContent.trim();
                        break;
                    }
                }

                // Connections count
                const connectionElements = document.querySelectorAll('.t-black--light, .pv-top-card--list-bullet');
                connectionElements.forEach(el => {
                    const text = el.textContent?.trim();
                    if (text && (text.includes('connection') || text.includes('follower'))) {
                        if (text.includes('connection')) data.connections = text;
                        if (text.includes('follower')) data.followers = text;
                    }
                });

                // About section
                const aboutSelectors = [
                    '#about + * .inline-show-more-text',
                    '.pv-about-section .inline-show-more-text',
                    '[data-field="summary"] .inline-show-more-text'
                ];
                
                for (const selector of aboutSelectors) {
                    const element = document.querySelector(selector);
                    if (element && element.textContent && element.textContent.trim().length > 10) {
                        data.about = element.textContent.trim();
                        break;
                    }
                }

                // Basic success check
                if (data.name || data.headline) {
                    data.scrapingSuccess = true;
                }

                // Debug info
                data.debug = {
                    pageTitle: document.title,
                    url: window.location.href,
                    hasH1: !!document.querySelector('h1'),
                    h1Text: document.querySelector('h1')?.textContent?.trim(),
                    bodyClass: document.body.className
                };

            } catch (error) {
                data.error = error.message;
            }

            return data;
        });

        await Actor.pushData(profileData);
        
        console.log('Scraping completed!');
        console.log('Success:', profileData.scrapingSuccess);
        console.log('Name:', profileData.name || 'Not found');
        console.log('Headline:', profileData.headline || 'Not found');
        console.log('URL:', profileData.url);

    } catch (error) {
        console.log('Error:', error.message);
        
        // Save error info
        await Actor.pushData({
            error: error.message,
            url: page.url(),
            timestamp: new Date().toISOString()
        });
    }

    await browser.close();
});
