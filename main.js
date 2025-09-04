const Apify = require('apify');

Apify.main(async () => {
    const input = await Apify.getInput();
    const { 
        linkedinCookies,   
        profileUrl,        // Ex: https://www.linkedin.com/in/eliasse-hamour-08194821a/
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

    // Set cookies
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
            
            await page.goto(profileUrl, { waitUntil: 'networkidle', timeout: 30000 });
            
            // Vérifier si détecté/bloqué
            const isBlocked = await page.$('text=challenge') || 
                             await page.$('text=blocked') ||
                             await page.$('text=captcha') ||
                             await page.$('.challenge-page');
            
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
                                       document.querySelector('.pv-text-details__left-panel h1');
                    data.name = nameElement?.textContent?.trim();

                    // Titre/poste actuel
                    const titleElement = document.querySelector('.text-body-medium.break-words') ||
                                        document.querySelector('.pv-text-details__left-panel .text-body-medium');
                    data.title = titleElement?.textContent?.trim();

                    // Localisation
                    const locationElement = document.querySelector('.text-body-small.inline.t-black--light.break-words') ||
                                           document.querySelector('.pv-text-details__left-panel .text-body-small');
                    data.location = locationElement?.textContent?.trim();

                    // Nombre de connexions
                    const connectionsElement = document.querySelector('.t-black--light .t-bold') ||
                                              document.querySelector('[data-anonymize="member-connections"]');
                    data.connections = connectionsElement?.textContent?.trim();

                    // Photo de profil
                    const photoElement = document.querySelector('.pv-top-card-profile-picture__image') ||
                                        document.querySelector('img[data-anonymize="headshot-photo"]');
                    data.profilePhoto = photoElement?.src;

                    // Section À propos
                    const aboutElement = document.querySelector('#about ~ .pv-shared-text-with-see-more .inline-show-more-text') ||
                                        document.querySelector('.pv-about-section .pv-about__summary-text');
                    data.about = aboutElement?.textContent?.trim();

                    // Expériences
                    data.experiences = [];
                    const experienceItems = document.querySelectorAll('.pvs-list__item--line-separated .pvs-entity') ||
                                           document.querySelectorAll('.pv-experience-section .pv-entity__summary-info');
                    
                    experienceItems.forEach(item => {
                        try {
                            const jobTitle = item.querySelector('.mr1.t-bold span[aria-hidden="true"]')?.textContent?.trim() ||
                                           item.querySelector('.pv-entity__summary-info h3')?.textContent?.trim();
                            
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
                    });

                    // Éducation
                    data.education = [];
                    const educationItems = document.querySelectorAll('.pvs-list__item--line-separated .pvs-entity') ||
                                          document.querySelectorAll('.pv-education-section .pv-entity__summary-info');
                    
                    educationItems.forEach(item => {
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
                    });

                    // Compétences (si visibles)
                    data.skills = [];
                    const skillItems = document.querySelectorAll('.pvs-list__item .mr1.t-bold span[aria-hidden="true"]') ||
                                      document.querySelectorAll('.pv-skill-category-entity__name span');
                    
                    skillItems.forEach(skill => {
                        const skillName = skill?.textContent?.trim();
                        if (skillName && !data.skills.includes(skillName)) {
                            data.skills.push(skillName);
                        }
                    });

                } catch (error) {
                    console.log('Error extracting profile data:', error);
                    data.error = error.message;
                }

                return data;
            });

            // Save data
            await Apify.pushData(profileData);
            console.log('✅ Profile scraped successfully!');
            console.log(`📊 Found: ${profileData.name} - ${profileData.title}`);
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
            await page.waitForTimeout(60000 + randomDelay());
        }
    }

    await browser.close();
    console.log('🎉 Profile scraping completed!');
});
