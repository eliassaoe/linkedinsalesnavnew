# LinkedIn Sales Navigator Scraper

Apify actor to scrape LinkedIn Sales Navigator with your own cookies.

## Setup

1. Get your LinkedIn cookies (F12 → Application → Cookies)
2. Copy `li_at` and `JSESSIONID` values
3. Run the actor with your cookies and target URL

## Input

```json
{
    "linkedinCookies": [
        {"name": "li_at", "value": "YOUR_TOKEN", "domain": ".linkedin.com"}
    ],
    "startUrl": "https://www.linkedin.com/sales/search/people?keywords=developer"
}
