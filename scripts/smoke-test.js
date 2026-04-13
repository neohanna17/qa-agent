/**
 * QA Smoke Test Agent — Google Gemini Vision + Per-Site UI Checks
 *
 * Each site has specific checks based on what was actually seen on the page:
 * - Logo present
 * - Key navigation items present
 * - Critical buttons present and clickable
 * - Donation form elements present
 * - No broken critical flows
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const FIREBASE_URL   = (process.env.FIREBASE_DATABASE_URL || '').replace(/\/$/, '');
const GEMINI_KEY     = process.env.GEMINI_API_KEY || '';
const SINGLE_SITE    = process.env.SINGLE_SITE   || '';
const SCREENSHOT_DIR = '/tmp/qa-screenshots';
const GEMINI_MODEL   = 'gemini-1.5-flash';
const GEMINI_URL     = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`;

if (!FIREBASE_URL) { console.error('FIREBASE_DATABASE_URL is not set'); process.exit(1); }
if (!GEMINI_KEY)   { console.error('GEMINI_API_KEY is not set');         process.exit(1); }

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

// ── Helper: check if element exists on page ───────────────────────
async function elExists(page, selector) {
  try { return await page.locator(selector).first().isVisible({ timeout: 3000 }); }
  catch { return false; }
}

// ── Helper: check if text exists anywhere on page ─────────────────
async function textExists(page, text) {
  try {
    const count = await page.getByText(text, { exact: false }).count();
    return count > 0;
  } catch { return false; }
}

// ── Helper: check if a link/button navigates somewhere ────────────
async function linkWorks(page, selector, context) {
  try {
    const el = page.locator(selector).first();
    if (!await el.isVisible({ timeout: 3000 })) return { pass: false, reason: 'Element not visible' };
    const href = await el.getAttribute('href').catch(() => null);
    if (href && (href.startsWith('http') || href.startsWith('/'))) {
      return { pass: true, href };
    }
    // If no href, check it's at least a button with onclick or similar
    const tag = await el.evaluate(e => e.tagName.toLowerCase());
    if (tag === 'button' || tag === 'a') return { pass: true, href: href || '(button)' };
    return { pass: false, reason: 'No valid href or button' };
  } catch (e) { return { pass: false, reason: e.message }; }
}

// ── Per-site specific UI checks ───────────────────────────────────
// Each returns array of { name, pass, detail }
const SITE_CHECKS = {

  uh: async (page) => {
    // United Hatzalah - donate page has equipment cards + currency selector
    await page.goto('https://israelrescue.org/donate', { waitUntil: 'domcontentloaded', timeout: 30000 });
    try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch {}
    await page.waitForTimeout(2000);
    return [
      { name: 'Logo visible',                  pass: await elExists(page, 'img[alt*="Hatzalah"], img[alt*="hatzalah"], img[alt*="United"], .logo img, header img') },
      { name: 'Currency selector present',     pass: await elExists(page, 'select, [class*="currency"], [class*="Currency"]') },
      { name: '"Donate Custom Amount" button', pass: await textExists(page, 'Donate Custom Amount') },
      { name: 'Equipment donation cards',      pass: await textExists(page, 'Donate $') || await textExists(page, 'EpiPen') || await textExists(page, 'Oxygen') },
      { name: '"Donate Equipment Now" button', pass: await textExists(page, 'Donate Equipment Now') || await textExists(page, 'Donate Now') },
      { name: 'Donation amount buttons',       pass: await elExists(page, '[class*="donate"], [class*="amount"], button') },
    ];
  },

  chaiathon: async (page) => {
    await page.goto('https://chaiathon.org', { waitUntil: 'domcontentloaded', timeout: 30000 });
    try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch {}
    await page.waitForTimeout(2000);
    return [
      { name: 'Logo visible',               pass: await elExists(page, 'img[alt*="Chai"], img[alt*="chai"], header img, .logo img, nav img') },
      { name: '"Fundraisers" nav item',     pass: await textExists(page, 'Fundraisers') },
      { name: '"Teams" nav item',           pass: await textExists(page, 'Teams') },
      { name: '"Prizes" nav item',          pass: await textExists(page, 'Prizes') },
      { name: 'Search bar present',         pass: await elExists(page, 'input[type="search"], input[placeholder*="Find"], input[placeholder*="Search"]') },
      { name: '"Register" button present',  pass: await textExists(page, 'Register') },
      { name: '"Login" button present',     pass: await textExists(page, 'Login') },
      { name: '"Donate" button present',    pass: await textExists(page, 'Donate') },
      { name: 'Fundraiser count stat',      pass: await textExists(page, 'Fundraisers') && await elExists(page, '[class*="stat"], [class*="count"], [class*="number"]') },
      { name: '"Order your Kit" button',    pass: await textExists(page, 'Order') && (await textExists(page, 'Kit') || await textExists(page, 'kit')) },
    ];
  },

  fcl: async (page) => {
    await page.goto('https://fundraise.chailifeline.org', { waitUntil: 'domcontentloaded', timeout: 30000 });
    try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch {}
    await page.waitForTimeout(2000);
    return [
      { name: 'Logo visible',                       pass: await elExists(page, 'img[alt*="Chai"], img[alt*="Lifeline"], header img, .logo img') },
      { name: '"Learn More" button present',        pass: await textExists(page, 'Learn More') || await textExists(page, 'Learn more') },
      { name: '"Donate Now" button present',        pass: await textExists(page, 'Donate Now') || await textExists(page, 'Donate') },
      { name: 'Hero/banner section loads',          pass: await elExists(page, '[class*="hero"], [class*="banner"], [class*="Hero"], section') },
      { name: 'Campaign cards visible',             pass: await elExists(page, '[class*="card"], [class*="Card"]') || await elExists(page, 'article') },
    ];
  },

  clc: async (page) => {
    await page.goto('https://fundraise.chailifelinecanada.org', { waitUntil: 'domcontentloaded', timeout: 30000 });
    try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch {}
    await page.waitForTimeout(2000);
    return [
      { name: 'Logo visible',               pass: await elExists(page, 'img[alt*="Chai"], header img, .logo img') },
      { name: '"Ways to Give" nav present', pass: await textExists(page, 'Ways to Give') || await textExists(page, 'Ways to give') },
      { name: '"Login" button present',     pass: await textExists(page, 'Login') },
      { name: '"Sign Up" button present',   pass: await textExists(page, 'Sign Up') || await textExists(page, 'Sign up') },
      { name: 'Donation amount options',    pass: await textExists(page, 'C$') || await textExists(page, 'Give once') || await textExists(page, 'Monthly') },
      { name: 'Donation form visible',      pass: await elExists(page, 'form, [class*="form"], [class*="donation"]') },
    ];
  },

  afmda: async (page) => {
    await page.goto('https://crowdfund.afmda.org', { waitUntil: 'domcontentloaded', timeout: 30000 });
    try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch {}
    await page.waitForTimeout(2000);
    return [
      { name: 'Logo visible',            pass: await elExists(page, 'img[alt*="AFMDA"], img[alt*="Magen"], header img, .logo img') },
      { name: 'Donate button present',   pass: await textExists(page, 'Donate') },
      { name: 'Campaign content loads',  pass: await elExists(page, '[class*="campaign"], [class*="card"], section') },
      { name: 'Navigation present',      pass: await elExists(page, 'nav, header') },
    ];
  },

  misaskim: async (page) => {
    await page.goto('https://misaskim.ca', { waitUntil: 'domcontentloaded', timeout: 30000 });
    try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch {}
    await page.waitForTimeout(2000);
    return [
      { name: 'Logo visible',          pass: await elExists(page, 'img[alt*="Misaskim"], img[alt*="misaskim"], header img, .logo img') },
      { name: 'Donate button present', pass: await textExists(page, 'Donate') },
      { name: 'Navigation present',    pass: await elExists(page, 'nav, header') },
      { name: 'Page has main content', pass: await elExists(page, 'main, [class*="main"], [class*="hero"], section') },
    ];
  },

  mizrachi: async (page) => {
    await page.goto('https://fundraise.mizrachi.ca', { waitUntil: 'domcontentloaded', timeout: 30000 });
    try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch {}
    await page.waitForTimeout(2000);
    return [
      { name: 'Logo visible',          pass: await elExists(page, 'img[alt*="Mizrachi"], header img, .logo img') },
      { name: 'Donate button present', pass: await textExists(page, 'Donate') },
      { name: 'Navigation present',    pass: await elExists(page, 'nav, header') },
      { name: 'Page has content',      pass: await elExists(page, 'main, section, [class*="hero"]') },
    ];
  },

  shomrim: async (page) => {
    await page.goto('https://shomrimtoronto.org', { waitUntil: 'domcontentloaded', timeout: 30000 });
    try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch {}
    await page.waitForTimeout(2000);
    return [
      { name: 'Logo visible',                  pass: await elExists(page, 'img[alt*="Shomrim"], header img, .logo img') },
      { name: '"About" nav item',              pass: await textExists(page, 'About') },
      { name: '"Donate" nav item',             pass: await textExists(page, 'Donate') },
      { name: '"File an incident" button',     pass: await textExists(page, 'File an incident') || await textExists(page, 'File an Incident') },
      { name: 'Emergency phone number',        pass: await textExists(page, '647') || await textExists(page, 'Emergency') },
      { name: '"Learn More" / CTA button',     pass: await textExists(page, 'Learn More') || await textExists(page, 'Volunteer') },
    ];
  },

  fallen: async (page) => {
    await page.goto('https://fallenh.org', { waitUntil: 'domcontentloaded', timeout: 30000 });
    try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch {}
    await page.waitForTimeout(2000);
    return [
      { name: 'Logo visible',                       pass: await elExists(page, 'img[alt*="Fallen"], img[alt*="Heroes"], header img, .logo img') },
      { name: '"DONATE" button in header',          pass: await textExists(page, 'Donate') || await textExists(page, 'DONATE') },
      { name: '"Our Fundraising Campaigns" link',   pass: await textExists(page, 'Fundraising Campaigns') || await textExists(page, 'Our Fundraising') },
      { name: 'Donation amount buttons present',    pass: await textExists(page, '$180') || await textExists(page, '$360') || await textExists(page, '180') },
      { name: '"Custom amount" option',             pass: await textExists(page, 'custom amount') || await textExists(page, 'Custom Amount') || await textExists(page, 'Other') },
      { name: 'Dedication option',                  pass: await textExists(page, 'dedicated') || await textExists(page, 'dedication') },
    ];
  },

  nitzanim: async (page) => {
    await page.goto('https://members.kehilatnitzanim.org', { waitUntil: 'domcontentloaded', timeout: 30000 });
    try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch {}
    await page.waitForTimeout(2000);
    return [
      { name: 'Logo visible',          pass: await elExists(page, 'img[alt*="Nitzanim"], img[alt*="Kehilat"], header img, .logo img') },
      { name: 'Navigation present',    pass: await elExists(page, 'nav, header') },
      { name: 'Login/Join option',     pass: await textExists(page, 'Login') || await textExists(page, 'Join') || await textExists(page, 'Sign') },
      { name: 'Page has main content', pass: await elExists(page, 'main, section, [class*="hero"]') },
    ];
  },

  imf: async (page) => {
    await page.goto('https://israelmagenfund.org', { waitUntil: 'domcontentloaded', timeout: 30000 });
    try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch {}
    await page.waitForTimeout(2000);
    return [
      { name: 'Logo visible',                    pass: await elExists(page, 'img[alt*="Magen"], img[alt*="Israel"], header img, .logo img') },
      { name: '"DONATE NOW" button',             pass: await textExists(page, 'Donate Now') || await textExists(page, 'DONATE NOW') },
      { name: '"Become a Fundraiser" nav link',  pass: await textExists(page, 'Become a Fundraiser') || await textExists(page, 'Fundraiser') },
      { name: 'Hero headline present',           pass: await textExists(page, 'SAFER') || await textExists(page, 'TOMORROW') || await textExists(page, 'Safeguarding') },
      { name: '"Our Impact" section',            pass: await textExists(page, 'Impact') || await textExists(page, 'IMPACT') },
    ];
  },

  adi: async (page) => {
    await page.goto('https://adi-il.org', { waitUntil: 'domcontentloaded', timeout: 30000 });
    try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch {}
    await page.waitForTimeout(2000);
    return [
      { name: 'Logo visible',          pass: await elExists(page, 'img[alt*="ADI"], img[alt*="Adi"], header img, .logo img') },
      { name: 'Donate button present', pass: await textExists(page, 'Donate') || await textExists(page, 'תרום') },
      { name: 'Navigation present',    pass: await elExists(page, 'nav, header') },
      { name: 'Page has main content', pass: await elExists(page, 'main, section, [class*="hero"]') },
    ];
  },

  yeshiva: async (page) => {
    await page.goto('https://donate.theyeshiva.net', { waitUntil: 'domcontentloaded', timeout: 30000 });
    try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch {}
    await page.waitForTimeout(2000);
    return [
      { name: 'Logo visible',                  pass: await elExists(page, 'img[alt*="Yeshiva"], img[alt*="yeshiva"], header img, .logo img') },
      { name: '"Back to Home" button',          pass: await textExists(page, 'Back to Home') || await textExists(page, 'Back') },
      { name: 'Donation options present',       pass: await textExists(page, 'Donation Options') || await textExists(page, 'Sponsor') || await textExists(page, 'Dedication') },
      { name: 'Donation tiers visible',         pass: await textExists(page, '$1,000') || await textExists(page, '$500') || await textExists(page, '1000') },
      { name: '"Give once" / "Monthly" toggle', pass: await textExists(page, 'Give once') || await textExists(page, 'Monthly') || await textExists(page, 'One-time') },
    ];
  },

  nahal: async (page) => {
    await page.goto('https://give.nahalharedi.org', { waitUntil: 'domcontentloaded', timeout: 30000 });
    try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch {}
    await page.waitForTimeout(2000);
    return [
      { name: 'Logo visible',               pass: await elExists(page, 'img[alt*="Nahal"], img[alt*="Haredi"], header img, .logo img') },
      { name: '"Campaigns" nav item',       pass: await textExists(page, 'Campaigns') },
      { name: '"eCards" nav item',          pass: await textExists(page, 'eCards') || await textExists(page, 'Ecards') },
      { name: '"DONATE" button',            pass: await textExists(page, 'Donate') || await textExists(page, 'DONATE') },
      { name: 'Donation form present',      pass: await textExists(page, 'Give once') || await textExists(page, 'Monthly') || await elExists(page, 'form') },
      { name: 'Donation amounts visible',   pass: await textExists(page, '$ 18') || await textExists(page, '$18') || await textExists(page, '$ 36') },
    ];
  },

  r2bo: async (page) => {
    await page.goto('https://racetobais.olami.org', { waitUntil: 'domcontentloaded', timeout: 30000 });
    try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch {}
    await page.waitForTimeout(2000);
    return [
      { name: 'Page loads with content',   pass: await textExists(page, 'Race') || await textExists(page, 'Bais') || await textExists(page, 'Yeshiva') },
      { name: 'CTA buttons present',       pass: await elExists(page, 'button, a[href*="donate"], a[class*="btn"]') },
      { name: 'Campaign info visible',     pass: await textExists(page, '100') || await textExists(page, 'young men') || await textExists(page, 'Florida') },
    ];
  },

  ots: async (page) => {
    await page.goto('https://fundraise.ots.org.il', { waitUntil: 'domcontentloaded', timeout: 30000 });
    try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch {}
    await page.waitForTimeout(2000);
    return [
      { name: 'Logo visible',                  pass: await elExists(page, 'img[alt*="OTS"], img[alt*="Torah"], img[alt*="Stone"], header img, .logo img') },
      { name: '"Donate" button present',       pass: await textExists(page, 'Donate') || await textExists(page, 'DONATE') },
      { name: 'Language selector present',     pass: await textExists(page, 'English') || await elExists(page, '[class*="lang"], select') },
      { name: 'Donation amounts present',      pass: await textExists(page, '$ 36') || await textExists(page, '$36') || await textExists(page, '$ 50') || await textExists(page, '$50') },
      { name: '"Give once" / "Monthly"',       pass: await textExists(page, 'Give once') || await textExists(page, 'Monthly') },
      { name: '"Dedication" option',           pass: await textExists(page, 'dedicated') || await textExists(page, 'Dedication') },
    ];
  },

  pantry: async (page) => {
    await page.goto('https://give.pantrypackers.org', { waitUntil: 'domcontentloaded', timeout: 30000 });
    try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch {}
    await page.waitForTimeout(2000);
    return [
      { name: 'Logo visible',          pass: await elExists(page, 'img[alt*="Pantry"], header img, .logo img') },
      { name: 'Donate button present', pass: await textExists(page, 'Donate') },
      { name: 'Navigation present',    pass: await elExists(page, 'nav, header') },
      { name: 'Page has content',      pass: await elExists(page, 'main, section, [class*="hero"]') },
    ];
  },

  israelthon: async (page) => {
    await page.goto('https://israelthon.org', { waitUntil: 'domcontentloaded', timeout: 30000 });
    try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch {}
    await page.waitForTimeout(2000);
    return [
      { name: 'Logo visible',          pass: await elExists(page, 'img[alt*="Israelthon"], img[alt*="israel"], header img, .logo img') },
      { name: 'Donate button present', pass: await textExists(page, 'Donate') },
      { name: 'Navigation present',    pass: await elExists(page, 'nav, header') },
      { name: 'Page has main content', pass: await elExists(page, 'main, section, [class*="hero"]') },
    ];
  },

  yorkville: async (page) => {
    await page.goto('https://donate.yorkvillejewishcentre.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
    try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch {}
    await page.waitForTimeout(2000);
    return [
      { name: 'Logo visible',                pass: await elExists(page, 'img[alt*="Yorkville"], img[alt*="Jewish"], header img, .logo img') },
      { name: 'Donate button present',       pass: await textExists(page, 'Donate') },
      { name: 'Donation form present',       pass: await elExists(page, 'form, [class*="form"], [class*="donation"]') },
      { name: 'Donation amounts visible',    pass: await elExists(page, 'button, [class*="amount"]') && (await textExists(page, '$') || await textExists(page, 'amount')) },
    ];
  },
};

// ── Generic error patterns ────────────────────────────────────────
const ERROR_TITLE_WORDS  = ['404','403','500','502','503','504','not found','error','page not found','access denied','forbidden','bad gateway','service unavailable','internal server error'];
const ERROR_BODY_PHRASES = ["this site can't be reached","this page isn't working",'err_connection_refused','dns_probe_finished','application error','database connection','fatal error','under construction','coming soon','parked domain','buy this domain','this domain is for sale','account suspended','bandwidth limit exceeded'];

const SITES = [
  { id: 'pantry',     name: 'Pantry Packers',          url: 'https://give.pantrypackers.org/'           },
  { id: 'israelthon', name: 'Israelthon',               url: 'https://israelthon.org/'                   },
  { id: 'yorkville',  name: 'Yorkville Jewish Centre',  url: 'https://donate.yorkvillejewishcentre.com/' },
  { id: 'chaiathon',  name: 'Chaiathon',                url: 'https://chaiathon.org'                     },
  { id: 'fcl',        name: 'Chai Lifeline USA',         url: 'https://fundraise.chailifeline.org'        },
  { id: 'uh',         name: 'United Hatzalah',           url: 'https://israelrescue.org'                  },
  { id: 'clc',        name: 'Chai Lifeline Canada',      url: 'https://fundraise.chailifelinecanada.org'  },
  { id: 'afmda',      name: 'AFMDA',                    url: 'https://crowdfund.afmda.org'               },
  { id: 'misaskim',   name: 'Misaskim',                 url: 'https://misaskim.ca'                       },
  { id: 'mizrachi',   name: 'Mizrachi',                 url: 'https://fundraise.mizrachi.ca'             },
  { id: 'shomrim',    name: 'Shomrim Toronto',          url: 'https://shomrimtoronto.org'                },
  { id: 'fallen',     name: 'Fallen Heroes',            url: 'https://fallenh.org'                       },
  { id: 'nitzanim',   name: 'Nitzanim',                 url: 'https://members.kehilatnitzanim.org/'      },
  { id: 'imf',        name: 'Israel Magen Fund',        url: 'https://israelmagenfund.org/'              },
  { id: 'adi',        name: 'ADI',                      url: 'https://adi-il.org/'                       },
  { id: 'yeshiva',    name: 'The Yeshiva',              url: 'https://donate.theyeshiva.net'             },
  { id: 'nahal',      name: 'Nahal Haredi',             url: 'https://give.nahalharedi.org/'             },
  { id: 'r2bo',       name: 'Race to Bais Olami',       url: 'https://racetobais.olami.org/'             },
  { id: 'ots',        name: 'Ohr Torah Stone',          url: 'https://fundraise.ots.org.il/'             },
];

const log = (msg, type = 'info') => {
  const icons = { info: '  ', pass: '✅', fail: '❌', warn: '⚠️ ', ai: '🤖', check: '  →' };
  console.log(`${icons[type] || '  '} ${msg}`);
};

async function fbWrite(fbPath, data) {
  const url = `${FIREBASE_URL}/${fbPath}.json`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Firebase [${res.status}]: ${await res.text()}`);
}

async function analyzeWithGemini(screenshotBase64, site) {
  const prompt = `You are a QA agent checking "${site.name}" at ${site.url}.

REPORT only these as major failures:
- Blank or white page with no content
- HTTP error pages (404, 500, 503 etc.)
- "This site can't be reached" or DNS failures
- Domain parking / "buy this domain" / suspended pages
- "Coming soon" or "Under construction" pages
- Database or server crash messages
- Wrong website showing entirely
- Login wall on a public page

DO NOT report: text changes, new campaigns, updated images, layout tweaks, cookie banners, popups.

Reply ONLY with valid JSON:
{"passing":true,"majorIssues":[],"pageDescription":"one sentence describing what you see"}`;

  try {
    const res = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [
          { inline_data: { mime_type: 'image/jpeg', data: screenshotBase64 } },
          { text: prompt },
        ]}],
        generationConfig: { temperature: 0.1, maxOutputTokens: 300 },
      }),
    });
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0,200)}`);
    const json = await res.json();
    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    return {
      passing: Boolean(parsed.passing),
      majorIssues: Array.isArray(parsed.majorIssues) ? parsed.majorIssues : [],
      pageDescription: parsed.pageDescription || 'Analysis complete.',
    };
  } catch (err) {
    log(`  Gemini error: ${err.message}`, 'warn');
    return { passing: null, majorIssues: [], pageDescription: 'Vision analysis unavailable.', error: err.message };
  }
}

async function testSite(browser, site) {
  log(`Testing ${site.name}...`);
  const result = {
    id: site.id, name: site.name, url: site.url,
    runAt: new Date().toISOString(),
    status: 'pass', checks: {}, uiChecks: [], majorFailures: [], aiAnalysis: null,
  };

  let context;
  try {
    context = await browser.newContext({
      ignoreHTTPSErrors: true,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();

    // ── 1. Generic checks on homepage ──────────────────────────
    try {
      const t0 = Date.now();
      const response = await page.goto(site.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      const httpStatus = response?.status() ?? 0;
      result.checks.httpStatus = { pass: httpStatus < 400, value: httpStatus };
      result.checks.loadTimeMs = { pass: true, value: Date.now() - t0 };
      if (httpStatus >= 400) result.majorFailures.push(`HTTP ${httpStatus} error`);
    } catch (navErr) {
      result.checks.httpStatus = { pass: false, error: navErr.message };
      result.majorFailures.push(`Page failed to load: ${navErr.message.split('\n')[0]}`);
      result.status = 'error';
      await context.close();
      return finalise(result);
    }

    try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch {}
    await page.waitForTimeout(2000);

    const title = await page.title().catch(() => '');
    const badTitle = ERROR_TITLE_WORDS.some(w => title.toLowerCase().includes(w));
    result.checks.pageTitle = { pass: !badTitle && title.length > 0, value: title };
    if (!result.checks.pageTitle.pass) result.majorFailures.push(`Error in page title: "${title}"`);

    const { bodyLength, bodySnippet } = await page.evaluate(() => {
      const t = document.body?.innerText || '';
      return { bodyLength: t.length, bodySnippet: t.slice(0, 600).toLowerCase() };
    }).catch(() => ({ bodyLength: 0, bodySnippet: '' }));

    result.checks.contentLength = { pass: bodyLength > 300, value: bodyLength };
    if (!result.checks.contentLength.pass) result.majorFailures.push('Page appears blank');

    const errorPhrase = ERROR_BODY_PHRASES.find(p => bodySnippet.includes(p));
    result.checks.noErrorContent = { pass: !errorPhrase };
    if (errorPhrase) result.majorFailures.push(`Error phrase found: "${errorPhrase}"`);

    const interactiveCount = await page.evaluate(() =>
      document.querySelectorAll('button,a[href],input[type=submit],input[type=button]').length
    ).catch(() => 0);
    result.checks.interactiveElements = { pass: interactiveCount > 3, value: interactiveCount };
    if (!result.checks.interactiveElements.pass) result.majorFailures.push(`Only ${interactiveCount} interactive elements found`);

    // ── 2. Per-site specific UI checks ──────────────────────────
    if (SITE_CHECKS[site.id]) {
      try {
        const uiResults = await SITE_CHECKS[site.id](page);
        result.uiChecks = uiResults;

        const failedUI = uiResults.filter(c => !c.pass);
        if (failedUI.length > 0) {
          // Only flag as major failure if more than 2 specific checks fail
          // (1-2 failures could be minor variations, 3+ is a real problem)
          if (failedUI.length >= 3) {
            result.majorFailures.push(`${failedUI.length} UI elements missing: ${failedUI.map(c => c.name).join(', ')}`);
          } else {
            // Log as warning only
            failedUI.forEach(c => log(`    ⚠ UI check failed: ${c.name}`, 'warn'));
          }
        }

        const passCount = uiResults.filter(c => c.pass).length;
        log(`  UI checks: ${passCount}/${uiResults.length} passed`, passCount === uiResults.length ? 'pass' : 'warn');
        uiResults.forEach(c => log(`    ${c.pass ? '✓' : '✗'} ${c.name}`, 'check'));
      } catch (uiErr) {
        log(`  UI checks error: ${uiErr.message}`, 'warn');
      }
    }

    // ── 3. Screenshot + Gemini vision ────────────────────────────
    try {
      const screenshot = await page.screenshot({
        type: 'jpeg', quality: 72, fullPage: false,
        clip: { x: 0, y: 0, width: 1440, height: 900 },
      });
      fs.writeFileSync(path.join(SCREENSHOT_DIR, `${site.id}.jpg`), screenshot);
      log('  Running Gemini vision analysis...', 'ai');
      const ai = await analyzeWithGemini(screenshot.toString('base64'), site);
      result.aiAnalysis = ai;
      log(`  Gemini: ${ai.pageDescription}`, 'ai');
      if (ai.passing === false && ai.majorIssues?.length > 0) {
        for (const issue of ai.majorIssues) {
          const isDupe = result.majorFailures.some(f => f.toLowerCase().includes(issue.toLowerCase().slice(0, 20)));
          if (!isDupe) result.majorFailures.push(`[Vision] ${issue}`);
        }
      }
    } catch (ssErr) {
      log(`  Screenshot error: ${ssErr.message}`, 'warn');
    }

  } catch (outerErr) {
    result.majorFailures.push(`Unexpected error: ${outerErr.message}`);
    result.status = 'error';
  } finally {
    if (context) await context.close().catch(() => {});
  }

  return finalise(result);
}

function finalise(result) {
  result.status = result.majorFailures.length > 0 ? 'fail' : 'pass';
  if (result.status === 'pass') log(`${result.name} — PASSED`, 'pass');
  else log(`${result.name} — FAILED: ${result.majorFailures.join(' | ')}`, 'fail');
  return result;
}

async function main() {
  const date = new Date().toISOString().split('T')[0];
  console.log('\n══════════════════════════════════════════');
  console.log(`  QA Agent (Gemini + UI Checks) — ${date}`);
  console.log('══════════════════════════════════════════\n');

  const sitesToTest = SINGLE_SITE ? SITES.filter(s => s.id === SINGLE_SITE) : SITES;
  if (!sitesToTest.length) { console.error(`No site: "${SINGLE_SITE}"`); process.exit(1); }
  log(`Running ${sitesToTest.length} sites with per-site UI checks...`);

  const browser = await chromium.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  let passed = 0, failed = 0, errored = 0;
  const failures = [];

  for (let i = 0; i < sitesToTest.length; i++) {
    const site = sitesToTest[i];
    try {
      const result = await testSite(browser, site);
      if      (result.status === 'pass')  passed++;
      else if (result.status === 'error') errored++;
      else { failed++; failures.push(result); }
      await fbWrite(`autoResults/${date}/${site.id}`, result).catch(e =>
        log(`Firebase write failed for ${site.id}: ${e.message}`, 'warn')
      );
      if (i < sitesToTest.length - 1) await new Promise(r => setTimeout(r, 5000));
    } catch (err) {
      log(`Fatal error on ${site.name}: ${err.message}`, 'fail');
      errored++;
    }
  }

  await browser.close();

  const summary = {
    date, runAt: new Date().toISOString(),
    totalSites: sitesToTest.length, passed, failed, errored,
    hasMajorFailures: failures.length > 0,
    failedSites: failures.map(f => ({ id: f.id, name: f.name, url: f.url, majorFailures: f.majorFailures })),
  };
  await fbWrite(`autoSummary/${date}`, summary).catch(() => {});
  await fbWrite('autoLatest', { date, ...summary }).catch(() => {});

  console.log('\n══════════════════════════════════════════');
  console.log(`  Done: ${passed} passed · ${failed} failed · ${errored} errors`);
  console.log('══════════════════════════════════════════\n');

  if (failures.length > 0) {
    console.log('🚨 MAJOR FAILURES:\n');
    failures.forEach(f => {
      console.log(`  ▸ ${f.name} — ${f.url}`);
      f.majorFailures.forEach(i => console.log(`      → ${i}`));
    });
    process.exit(1);
  } else {
    console.log('✅ All sites healthy\n');
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
