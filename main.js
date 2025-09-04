const Apify = require('apify');

Apify.main(async () => {
    const input = await Apify.getInput();
    const { 
        linkedinCookies,   // OBLIGATOIRE - cookies user
        startUrl,          // OBLIGATOIRE - URL de départ user
        maxPages = 50,     
        minDelay = 3000,   
        maxDelay = 11000,
        maxRetries = 3
    } = input;

    // Validation des inputs obligatoires
    if (!linkedinCookies || !Array.isArray(linkedinCookies) || linkedinCookies.length === 0) {
        throw new Error('❌ linkedinCookies is required! Please provide your LinkedIn cookies.');
    }

    if (!startUrl) {
        throw new Error('❌ startUrl is required! Please provide the LinkedIn Sales Nav URL to start scraping.');
    }

    console.log('✅ Starting with user-provided URL:', startUrl);
    console.log('✅ Using', linkedinCookies.length, 'cookies');

    const browser = await Apify.launchPlaywright({
        headless: true,
        useApifyProxy: true,
        proxyConfiguration: await Apify.createProxyConfiguration({
            groups: ['RESIDENTIAL'],
            countryCode: 'US',
            sessionRotationCount: 15
        }),
        launchOptions: {
            args: [
                '--no-sandbox',
                '--disable-dev-shm-usage',
                '--disable-blink-features=AutomationControlled',
                '--disable-web-security'
            ]
        }
    });

    const page = await browser.newPage();

    // Stealth config
    await page.addInitScript(() => {
        delete navigator.__proto__.webdriver;
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    // Set user cookies
    await page.context().addCookies(linkedinCookies);
    console.log('✅ Cookies applied');

    await page.setExtraHTTPHeaders({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9,fr;q=0.8',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
    });

    const randomDelay = () => Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
    
    const humanBehavior = async () => {
        await page.evaluate(() => {
            window.scrollTo(0, Math.floor(Math.random() * 800));
        });
        await page.waitForTimeout(1000 + Math.random() * 2000);
        
        await page.mouse.move(
            Math.floor(Math.random() * 400), 
            Math.floor(Math.random() * 600)
        );
        await page.waitForTimeout(500 + Math.random() * 1000);
    };

    let pageCount = 0;

    try {
        // Navigation vers l'URL user
        console.log('🚀 Navigating to user URL...');
        await page.goto(startUrl, { waitUntil: 'networkidle', timeout: 30000 });
        await page.waitForTimeout(randomDelay());

        while (pageCount < maxPages) {
            let retries = 0;
            
            while (retries < maxRetries) {
                try {
                    console.log(`📄 Scraping page ${pageCount + 1}/${maxPages}`);
                    
                    // Vérifier détection
                    const isBlocked = await page.$('text=challenge') || 
                                     await page.$('text=blocked') ||
                                     await page.$('text=captcha') ||
                                     await page.$('[data-test-id="captcha"]');
                    
                    if (isBlocked) {
                        console.log('⚠️ Detection possible, waiting 2 minutes...');
                        await page.waitForTimeout(120000);
                        retries++;
                        continue;
                    }

                    await humanBehavior();

                    // Extract data
                    const pageData = await page.evaluate(() => {
                        const results = [];
                        
                        const profileCards = document.querySelectorAll('[data-view-name="search-results-lead"]') || 
                                           document.querySelectorAll('.artdeco-entity-lockup');
                        
                        profileCards.forEach(card => {
                            try {
                                const name = card.querySelector('span[aria-hidden="true"]')?.textContent?.trim();
                                const title = card.querySelector('.artdeco-entity-lockup__subtitle')?.textContent?.trim();
                                const company = card.querySelector('.artdeco-entity-lockup__caption')?.textContent?.trim();
                                
                                if (name) {
                                    results.push({ name, title, company });
                                }
                            } catch (e) {
                                console.log('Error extracting profile:', e);
                            }
                        });

                        return {
                            url: window.location.href,
                            timestamp: new Date().toISOString(),
                            results: results,
                            totalFound: results.length
                        };
                    });

                    if (pageData.results.length > 0) {
                        await Apify.pushData(pageData);
                        console.log(`✅ Extracted ${pageData.results.length} profiles`);
                    }

                    // Chercher next button
                    const nextButton = await page.$('button[aria-label="Next"]') || 
                                      await page.$('.artdeco-pagination__button--next:not([disabled])');
                    
                    if (!nextButton) {
                        console.log('🏁 No more pages available');
                        break;
                    }

                    await page.waitForTimeout(randomDelay());
                    await humanBehavior();
                    
                    await nextButton.click();
                    await page.waitForLoadState('networkidle');
                    
                    pageCount++;
                    break;
                    
                } catch (error) {
                    console.log(`❌ Error on page ${pageCount + 1}: ${error.message}`);
                    retries++;
                    
                    if (retries >= maxRetries) {
                        console.log('Max retries reached, stopping...');
                        break;
                    }
                    
                    await page.waitForTimeout(60000 + randomDelay());
                }
            }
            
            if (retries >= maxRetries) break;
            await page.waitForTimeout(randomDelay());
        }

    } catch (error) {
        console.log('Fatal error:', error);
        throw error;
    } finally {
        await browser.close();
    }

    console.log(`🎉 Scraping completed! Processed ${pageCount} pages`);
});
