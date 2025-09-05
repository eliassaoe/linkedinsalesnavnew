const { Actor } = require('apify');

Actor.main(async () => {
    const input = await Actor.getInput();
    const { linkedinCookies, profileUrl, maxRetries = 3 } = input;

    if (!linkedinCookies || !profileUrl) {
        throw new Error('linkedinCookies et profileUrl sont requis');
    }

    console.log('Starting LinkedIn profile scraping:', profileUrl);

    // Apify proxy configuration - residential US
    const proxyConfiguration = await Actor.createProxyConfiguration({
        groups: ['RESIDENTIAL'],
        countryCode: 'US'
    });

    // Launch Puppeteer with Apify's built-in stealth
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
                '--disable-features=VizDisplayCompositor'
            ]
        }
    });

    const page = await browser.newPage();

    // Enhanced stealth configuration
    await page.evaluateOnNewDocument(() => {
        delete navigator.__proto__.webdriver;
        
        Object.defineProperty(navigator, 'plugins', {
            get: () => [1, 2, 3, 4, 5]
        });
        
        Object.defineProperty(navigator, 'languages', {
            get: () => ['en-US', 'en']
        });
        
        const getParameter = WebGLRenderingContext.getParameter;
        WebGLRenderingContext.prototype.getParameter = function(parameter) {
            if (parameter === 37445) return 'Intel Inc.';
            if (parameter === 37446) return 'Intel Iris OpenGL Engine';
            return getParameter(parameter);
        };
    });

    // Realistic headers
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

    // Clean and apply cookies
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

    // Random delay function (15-25 seconds)
    const longDelay = () => Math.floor(Math.random() * 10000) + 15000;

    let retries = 0;
    
    while (retries < maxRetries) {
        try {
            console.log(`Attempt ${retries + 1}/${maxRetries}`);

            // Step 1: Establish session on LinkedIn feed (best practice)
            console.log('Establishing LinkedIn session...');
            await page.goto('https://www.linkedin.com/feed', { 
                waitUntil: 'domcontentloaded', 
                timeout: 45000 
            });
            
            // Wait and check if logged in
            await page.waitForTimeout(5000);
            
            const isLoggedIn = await page.evaluate(() => {
                return !document.querySelector('.nav__button-secondary') && 
                       !window.location.href.includes('authwall') &&
                       !window.location.href.includes('login');
            });

            if (!isLoggedIn) {
                console.log('Session not established - cookies may be invalid');
                retries++;
                await page.waitForTimeout(longDelay());
                continue;
            }

            console.log('Session established successfully');

            // Step 2: Wait before navigating to profile (anti-detection)
            await page.waitForTimeout(longDelay());

            // Step 3: Navigate to target profile
            console.log('Navigating to profile...');
            await page.goto(profileUrl, { 
                waitUntil: 'domcontentloaded', 
                timeout: 45000 
            });

            // Check for authwall/redirect
            const currentUrl = page.url();
            if (currentUrl.includes('authwall') || currentUrl.includes('login') || currentUrl.includes('signup')) {
                throw new Error('LinkedIn authwall detected - cookies expired or account flagged');
            }

            console.log('Profile page loaded successfully');

            // Step 4: Wait for content to load (LinkedIn uses heavy JS)
            await page.waitForTimeout(10000);

            // Step 5: Human-like scrolling to load dynamic content
            await page.evaluate(async () => {
                const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
                
                // Gradual scroll to load all sections
                for (let i = 0; i < 4; i++) {
                    const scrollPosition = (i + 1) * (document.body.scrollHeight / 5);
                    window.scrollTo({ top: scrollPosition, behavior: 'smooth' });
                    await delay(3000);
                }
                
                // Back to top
                window.scrollTo({ top: 0, behavior: 'smooth' });
                await delay(2000);
            });

            console.log('Page content loaded, extracting data...');

            // Step 6: Extract profile data with robust selectors
            const profileData = await page.evaluate(() => {
                const data = {
                    url: window.location.href,
                    timestamp: new Date().toISOString(),
                    scrapingSuccess: false
                };

                try {
                    // Name extraction with fallback selectors
                    const nameSelectors = [
                        'h1.text-heading-xlarge',
                        'h1.break-words',
                        '.pv-text-details__left-panel h1',
                        '.ph5 h1',
                        'h1'
                    ];
                    
                    for (const selector of nameSelectors) {
                        const element = document.querySelector(selector);
                        if (element?.textContent && 
                            !element.textContent.includes('Sign') && 
                            !element.textContent.includes('Join') &&
                            element.textContent.trim().length > 2) {
                            data.name = element.textContent.trim();
                            break;
                        }
                    }

                    // Headline/title
                    const titleSelectors = [
                        '.text-body-medium.break-words',
                        '.pv-text-details__left-panel .text-body-medium',
                        '.ph5 .text-body-medium'
                    ];
                    
                    for (const selector of titleSelectors) {
                        const element = document.querySelector(selector);
                        if (element?.textContent && 
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
                        if (element?.textContent && 
                            !element.textContent.includes('connection') && 
                            !element.textContent.includes('follower') &&
                            element.textContent.trim().length > 2) {
                            data.location = element.textContent.trim();
                            break;
                        }
                    }

                    // Connections/followers
                    const connectionElements = document.querySelectorAll('.t-black--light, .pv-top-card--list-bullet');
                    connectionElements.forEach(el => {
                        const text = el.textContent?.trim();
                        if (text) {
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
                        if (element?.textContent?.trim().length > 10) {
                            data.about = element.textContent.trim();
                            break;
                        }
                    }

                    // Experience (first 3 positions)
                    data.experiences = [];
                    const expSelectors = [
                        '#experience + * .pvs-entity',
                        '[data-field="experience"] .pvs-entity'
                    ];
                    
                    let experienceItems = [];
                    for (const selector of expSelectors) {
                        experienceItems = document.querySelectorAll(selector);
                        if (experienceItems.length > 0) break;
                    }
                    
                    experienceItems.forEach((item, index) => {
                        if (index < 3) { // Limit to top 3 positions
                            try {
                                const titleEl = item.querySelector('.mr1.t-bold span[aria-hidden="true"]') ||
                                              item.querySelector('.pvs-entity__path-node');
                                const companyEl = item.querySelector('.t-14.t-normal span[aria-hidden="true"]');
                                const durationEl = item.querySelector('.t-14.t-normal.t-black--light span[aria-hidden="true"]');

                                const jobTitle = titleEl?.textContent?.trim();
                                const company = companyEl?.textContent?.trim();
                                const duration = durationEl?.textContent?.trim();

                                if (jobTitle) {
                                    data.experiences.push({ jobTitle, company, duration });
                                }
                            } catch (e) {
                                console.log('Experience parsing error:', e);
                            }
                        }
                    });

                    // Success validation
                    if (data.name || data.headline) {
                        data.scrapingSuccess = true;
                    }

                    // Debug info
                    data.debug = {
                        pageTitle: document.title,
                        currentUrl: window.location.href,
                        hasProfileContent: !!document.querySelector('h1'),
                        sectionsFound: document.querySelectorAll('section').length
                    };

                } catch (error) {
                    data.error = error.message;
                }

                return data;
            });

            // Save results
            await Actor.pushData(profileData);
            
            console.log('Scraping completed successfully!');
            console.log('Name:', profileData.name || 'Not found');
            console.log('Headline:', profileData.headline || 'Not found');
            console.log('Location:', profileData.location || 'Not found');
            console.log('Experiences:', profileData.experiences?.length || 0);
            console.log('Success:', profileData.scrapingSuccess);

            break; // Success - exit retry loop

        } catch (error) {
            console.log(`Error on attempt ${retries + 1}: ${error.message}`);
            retries++;
            
            if (retries >= maxRetries) {
                console.log('Max retries reached - scraping failed');
                
                // Save error data
                await Actor.pushData({
                    error: error.message,
                    url: page.url(),
                    timestamp: new Date().toISOString(),
                    scrapingSuccess: false
                });
                
                break;
            }
            
            // Long delay before retry
            console.log('Waiting before retry...');
            await page.waitForTimeout(longDelay());
        }
    }

    await browser.close();
    console.log('Browser closed - scraping finished');
});
