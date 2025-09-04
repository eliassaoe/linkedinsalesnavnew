const { Actor } = require('apify');
const { chromium } = require('playwright');

Actor.main(async () => {
    const input = await Actor.getInput();
    const { 
        linkedinCookies,   
        startUrl: profileUrl,        
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

    // Set cookies
    await context.addCookies(linkedinCookies);
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
            
            // Vérifier si détecté/bloqué
            const isBlocked = await page.locator('text=challenge').first().isVisible().catch(() => false) || 
                             await page.locator('text=blocked').first().isVisible().catch(() => false) ||
                             await page.locator('text=captcha').first().isVisible().catch(() => false) ||
                             await page.locator('.challenge-page').first().isVisible().catch(() => false);
            
            if (isBlocked) {
                console.log('⚠️ Detection possible, waiting 2 minutes...');
                await page.waitForTimeout(120000);
                retries++;
                continue;
            }

            // Comportement humain - scroll pour charger tout le profil
            console.log('📖 Reading profile...');
            await humanBehavior();
            
            // Scroll pour charger expériences/éducation
            await page.evaluate(() => {
                window.scrollTo(0, document.body.scrollHeight / 2);
            });
            await page.waitForTimeout(3000);
            
            await page.evaluate(() => {
                window.scrollTo(0, document.body.scrollHeight);
            });
            await page.waitForTimeout(3000);

            console.log('🔍 Extracting profile data...');

            // Extract profile data
            const profileData = await page.evaluate(() => {
                const data = {
                    url: window.location.href,
                    timestamp: new Date().toISOString()
                };

                try {
                    // Nom complet
                    const nameElement = document.querySelector('h1.text-heading-xlarge') ||
                                       document.querySelector('[data-anonymize="person-name"]') ||
                                       document.querySelector('.pv-text-details__left-panel h1') ||
                                       document.querySelector('h1');
                    data.name = nameElement?.textContent?.trim();

                    // Titre/poste actuel
                    const titleElement = document.querySelector('.text-body-medium.break-words') ||
                                        document.querySelector('.pv-text-details__left-panel .text-body-medium') ||
                                        document.querySelector('[data-generated-suggestion-target]');
                    data.title = titleElement?.textContent?.trim();

                    // Localisation
                    const locationElement = document.querySelector('.text-body-small.inline.t-black--light.break-words') ||
                                           document.querySelector('.pv-text-details__left-panel .text-body-small') ||
                                           document.querySelector('.pb2.pv-text-details__left-panel .text-body-small');
                    data.location = locationElement?.textContent?.trim();

                    // Nombre de connexions
                    const connectionsElement = document.querySelector('.t-black--light .t-bold') ||
                                              document.querySelector('[data-anonymize="member-connections"]') ||
                                              document.querySelector('.pv-top-card--list-bullet .pv-top-card--list-bullet');
                    data.connections = connectionsElement?.textContent?.trim();

                    // Photo de profil
                    const photoElement = document.querySelector('.pv-top-card-profile-picture__image') ||
                                        document.querySelector('img[data-anonymize="headshot-photo"]') ||
                                        document.querySelector('.profile-photo-edit__preview img');
                    data.profilePhoto = photoElement?.src;

                    // Section À propos
                    const aboutElement = document.querySelector('#about ~ .pv-shared-text-with-see-more .inline-show-more-text') ||
                                        document.querySelector('.pv-about-section .pv-about__summary-text') ||
                                        document.querySelector('[data-generated-suggestion-target] + div');
                    data.about = aboutElement?.textContent?.trim();

                    // Expériences
                    data.experiences = [];
                    const experienceItems = document.querySelectorAll('.pvs-list__item--line-separated .pvs-entity') ||
                                           document.querySelectorAll('.pv-experience-section .pv-entity__summary-info') ||
                                           document.querySelectorAll('[data-field="experience"] .pvs-entity');
                    
                    experienceItems.forEach((item, index) => {
                        if (index < 10) { // Limite à 10 expériences
                            try {
                                const jobTitle = item.querySelector('.mr1.t-bold span[aria-hidden="true"]')?.textContent?.trim() ||
                                               item.querySelector('.pv-entity__summary-info h3')?.textContent?.trim() ||
                                               item.querySelector('.pvs-entity__path-node')?.textContent?.trim();
                                
                                const company = item.querySelector('.t-14.t-normal span[aria-hidden="true"]')?.textContent?.trim() ||
                                              item.querySelector('.pv-entity__secondary-title')?.textContent?.trim();
                                
                                const duration = item.querySelector('.t-14.t-normal.t-black--light span[aria-hidden="true"]')?.textContent?.trim() ||
                                               item.querySelector('.pv-entity__bullet-item')?.textContent?.trim();

                                if (jobTitle) {
                                    data.experiences.push({ jobTitle, company, duration });
                                }
                            } catch (e) {
                                console.log('Error parsing experience:', e);
                            }
                        }
                    });

                    // Éducation
                    data.education = [];
                    const educationItems = document.querySelectorAll('[data-field="education"] .pvs-entity') ||
                                          document.querySelectorAll('.pv-education-section .pv-entity__summary-info');
                    
                    educationItems.forEach((item, index) => {
                        if (index < 5) { // Limite à 5 formations
                            try {
                                const school = item.querySelector('.mr1.t-bold span[aria-hidden="true"]')?.textContent?.trim() ||
                                              item.querySelector('.pv-entity__school-name')?.textContent?.trim();
                                
                                const degree = item.querySelector('.t-14.t-normal span[aria-hidden="true"]')?.textContent?.trim() ||
                                              item.querySelector('.pv-entity__degree-name')?.textContent?.trim();
                                
                                const years = item.querySelector('.t-14.t-normal.t-black--light span[aria-hidden="true"]')?.textContent?.trim() ||
                                             item.querySelector('.pv-entity__dates')?.textContent?.trim();

                                if (school) {
                                    data.education.push({ school, degree, years });
                                }
                            } catch (e) {
                                console.log('Error parsing education:', e);
                            }
                        }
                    });

                    // Compétences (si visibles)
                    data.skills = [];
                    const skillItems = document.querySelectorAll('[data-field="skill"] .mr1.t-bold span[aria-hidden="true"]') ||
                                      document.querySelectorAll('.pv-skill-category-entity__name span');
                    
                    skillItems.forEach((skill, index) => {
                        if (index < 20) { // Limite à 20 compétences
                            const skillName = skill?.textContent?.trim();
                            if (skillName && !data.skills.includes(skillName)) {
                                data.skills.push(skillName);
                            }
                        }
                    });

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
