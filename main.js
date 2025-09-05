const { Actor } = require('apify');
const { chromium } = require('playwright');

Actor.main(async () => {
    const input = await Actor.getInput();
    const { 
        linkedinCookies,   
        profileUrl,        // Corrigé : juste profileUrl au lieu de profileUrl: profileUrl
        minDelay = 3000,   
        maxDelay = 11000,
        maxRetries = 3
    } = input;

    // Validation
    if (!linkedinCookies || !Array.isArray(linkedinCookies) || linkedinCookies.length === 0) {
        throw new Error('❌ linkedinCookies is required!');
    }

    if (!profileUrl) {
        throw new Error('❌ profileUrl is required!');
    }

    console.log('✅ Starting LinkedIn profile scraping:', profileUrl);
    console.log('✅ Using', linkedinCookies.length, 'cookies');

    // Fix pour les cookies - ils peuvent être dans un array imbriqué
    const cookiesArray = Array.isArray(linkedinCookies[0]) ? linkedinCookies[0] : linkedinCookies;
    console.log('✅ Processed cookies array:', cookiesArray.length);

    // Clean cookies for Playwright
    const cleanCookies = cookiesArray.map(cookie => ({
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

    const browser = await chromium.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-dev-shm-usage',
            '--disable-blink-features=AutomationControlled',
            '--disable-web-security'
        ]
    });

    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        extraHTTPHeaders: {
            'Accept-Language': 'en-US,en;q=0.9,fr;q=0.8',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1'
        }
    });

    // Set cleaned cookies
    await context.addCookies(cleanCookies);
    console.log('✅ Cookies applied');

    const page = await context.newPage();

    // Stealth config
    await page.addInitScript(() => {
        delete navigator.__proto__.webdriver;
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    const randomDelay = () => Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
    
    const humanBehavior = async () => {
        await page.evaluate(() => {
            window.scrollTo(0, Math.floor(Math.random() * 1000));
        });
        await page.waitForTimeout(2000 + Math.random() * 3000);
        
        await page.mouse.move(
            Math.floor(Math.random() * 400), 
            Math.floor(Math.random() * 600)
        );
        await page.waitForTimeout(1000 + Math.random() * 2000);
    };

    let retries = 0;
    
    while (retries < maxRetries) {
        try {
            console.log(`🚀 Loading profile (attempt ${retries + 1})...`);
            
            // Random delay avant navigation
            await page.waitForTimeout(randomDelay());
            
            console.log('🔄 Navigating to profile...');
            await page.goto(profileUrl, { waitUntil: 'networkidle', timeout: 60000 });
            console.log('✅ Page loaded');
            
            // Vérifier si détecté/bloqué - simplifié pour éviter les erreurs
            try {
                const challengeExists = await page.waitForSelector('text=challenge', { timeout: 1000 }).then(() => true).catch(() => false);
                const blockedExists = await page.waitForSelector('text=blocked', { timeout: 1000 }).then(() => true).catch(() => false);
                const captchaExists = await page.waitForSelector('text=captcha', { timeout: 1000 }).then(() => true).catch(() => false);
                
                if (challengeExists || blockedExists || captchaExists) {
                    console.log('⚠️ Detection possible, waiting 2 minutes...');
                    await page.waitForTimeout(120000);
                    retries++;
                    continue;
                }
            } catch (error) {
                console.log('Detection check failed, continuing...');
            }

            // Comportement humain - scroll pour charger tout le profil
            console.log('📖 Reading profile...');
            await humanBehavior();
            
            // Wait for dynamic content to load
            await page.waitForTimeout(8000);
            
            // Scroll pour charger expériences/éducation
            await page.evaluate(() => {
                window.scrollTo(0, document.body.scrollHeight / 3);
            });
            await page.waitForTimeout(4000);
            
            await page.evaluate(() => {
                window.scrollTo(0, document.body.scrollHeight / 2);
            });
            await page.waitForTimeout(4000);
            
            await page.evaluate(() => {
                window.scrollTo(0, document.body.scrollHeight);
            });
            await page.waitForTimeout(5000);

            console.log('🔍 Extracting profile data...');

            // Take screenshot for debugging
            await page.screenshot({ path: 'profile_page.png', fullPage: true });
            console.log('📸 Screenshot saved for debugging');

            // Extract profile data with updated selectors
            const profileData = await page.evaluate(() => {
                const data = {
                    url: window.location.href,
                    timestamp: new Date().toISOString(),
                    pageTitle: document.title
                };

                try {
                    // Log available elements for debugging
                    console.log('Page title:', document.title);
                    console.log('H1 elements:', document.querySelectorAll('h1').length);
                    console.log('All headings:', Array.from(document.querySelectorAll('h1, h2, h3')).map(h => h.textContent?.trim()).slice(0, 5));

                    // Nom complet - updated selectors
                    const nameSelectors = [
                        'h1.text-heading-xlarge',
                        'h1.break-words',
                        '.pv-text-details__left-panel h1',
                        '.ph5 h1',
                        'h1',
                        '[data-anonymize="person-name"]'
                    ];
                    
                    let nameElement = null;
                    for (const selector of nameSelectors) {
                        nameElement = document.querySelector(selector);
                        if (nameElement && nameElement.textContent?.trim()) break;
                    }
                    data.name = nameElement?.textContent?.trim();

                    // Titre/poste actuel - updated selectors
                    const titleSelectors = [
                        '.text-body-medium.break-words',
                        '.pv-text-details__left-panel .text-body-medium',
                        '.ph5 .text-body-medium',
                        '.pv-top-card .text-body-medium',
                        '[data-generated-suggestion-target]'
                    ];
                    
                    let titleElement = null;
                    for (const selector of titleSelectors) {
                        titleElement = document.querySelector(selector);
                        if (titleElement && titleElement.textContent?.trim() && 
                            !titleElement.textContent.includes('connection') && 
                            !titleElement.textContent.includes('follower')) break;
                    }
                    data.title = titleElement?.textContent?.trim();

                    // Localisation - updated selectors
                    const locationSelectors = [
                        '.text-body-small.inline.t-black--light.break-words',
                        '.pv-text-details__left-panel .text-body-small',
                        '.ph5 .text-body-small',
                        '.pv-top-card .text-body-small'
                    ];
                    
                    let locationElement = null;
                    for (const selector of locationSelectors) {
                        locationElement = document.querySelector(selector);
                        if (locationElement && locationElement.textContent?.trim() && 
                            !locationElement.textContent.includes('connection') && 
                            !locationElement.textContent.includes('follower')) break;
                    }
                    data.location = locationElement?.textContent?.trim();

                    // Connexions et followers
                    const connectionSelectors = [
                        '.pv-top-card--list-bullet',
                        '.t-black--light .t-bold',
                        '[data-anonymize="member-connections"]'
                    ];
                    
                    connectionSelectors.forEach(selector => {
                        const elements = document.querySelectorAll(selector);
                        elements.forEach(el => {
                            const text = el.textContent?.trim();
                            if (text && text.includes('connection')) {
                                data.connections = text;
                            }
                            if (text && text.includes('follower')) {
                                data.followers = text;
                            }
                        });
                    });

                    // Photo de profil
                    const photoSelectors = [
                        '.pv-top-card-profile-picture__image',
                        'img[data-anonymize="headshot-photo"]',
                        '.profile-photo-edit__preview img',
                        '.pv-top-card__photo img'
                    ];
                    
                    let photoElement = null;
                    for (const selector of photoSelectors) {
                        photoElement = document.querySelector(selector);
                        if (photoElement && photoElement.src) break;
                    }
                    data.profilePhoto = photoElement?.src;

                    // Section À propos
                    const aboutSelectors = [
                        '#about + * .inline-show-more-text',
                        '.pv-about-section .pv-about__summary-text',
                        '[data-field="summary"] .inline-show-more-text',
                        '.pv-shared-text-with-see-more .inline-show-more-text'
                    ];
                    
                    let aboutElement = null;
                    for (const selector of aboutSelectors) {
                        aboutElement = document.querySelector(selector);
                        if (aboutElement && aboutElement.textContent?.trim()) break;
                    }
                    data.about = aboutElement?.textContent?.trim();

                    // Expériences - updated selectors
                    data.experiences = [];
                    const experienceSelectors = [
                        '#experience + * .pvs-entity',
                        '[data-field="experience"] .pvs-entity',
                        '.pv-experience-section .pv-entity'
                    ];
                    
                    let experienceItems = [];
                    for (const selector of experienceSelectors) {
                        experienceItems = document.querySelectorAll(selector);
                        if (experienceItems.length > 0) break;
                    }
                    
                    experienceItems.forEach((item, index) => {
                        if (index < 10) {
                            try {
                                const titleEl = item.querySelector('.mr1.t-bold span[aria-hidden="true"]') ||
                                              item.querySelector('.pvs-entity__path-node') ||
                                              item.querySelector('h3');
                                              
                                const companyEl = item.querySelector('.t-14.t-normal span[aria-hidden="true"]') ||
                                                item.querySelector('.pvs-entity__secondary-title');
                                                
                                const durationEl = item.querySelector('.t-14.t-normal.t-black--light span[aria-hidden="true"]') ||
                                                 item.querySelector('.pvs-entity__caption-wrapper');

                                const jobTitle = titleEl?.textContent?.trim();
                                const company = companyEl?.textContent?.trim();
                                const duration = durationEl?.textContent?.trim();

                                if (jobTitle) {
                                    data.experiences.push({ jobTitle, company, duration });
                                }
                            } catch (e) {
                                console.log('Error parsing experience:', e);
                            }
                        }
                    });

                    // Debug info
                    data.debug = {
                        totalH1s: document.querySelectorAll('h1').length,
                        totalSections: document.querySelectorAll('section').length,
                        hasExperienceSection: !!document.querySelector('#experience'),
                        hasAboutSection: !!document.querySelector('#about'),
                        bodyClasses: document.body.className
                    };

                } catch (error) {
                    console.log('Error extracting profile data:', error);
                    data.error = error.message;
                }

                return data;
            });

            // Save data
            await Actor.pushData(profileData);
            console.log('✅ Profile scraped successfully!');
            console.log(`📊 Found: ${profileData.name || 'Unknown'} - ${profileData.title || 'No title'}`);
            console.log(`📈 Experiences: ${profileData.experiences?.length || 0}`);
            console.log(`🎓 Education: ${profileData.education?.length || 0}`);
            console.log(`💪 Skills: ${profileData.skills?.length || 0}`);
            
            break; // Success, sortir de la boucle
            
        } catch (error) {
            console.log(`❌ Error loading profile: ${error.message}`);
            retries++;
            
            if (retries >= maxRetries) {
                console.log('Max retries reached, giving up...');
                throw error;
            }
            
            // Pause longue en cas d'erreur
            console.log('⏳ Waiting before retry...');
            await page.waitForTimeout(60000 + randomDelay());
        }
    }

    await browser.close();
    console.log('🎉 Profile scraping completed!');
});
