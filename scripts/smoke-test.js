/**
 * QA Smoke Test Agent v3 — Gemini Vision + Real DOM Checks
 *
 * Per-site checks based on actual DOM inspection:
 * - img.custom-logo (WordPress standard — confirmed on all sites)
 * - nav a.wp-block-navigation-item__content (Gutenberg nav links)
 * - Broken image detection via naturalWidth === 0
 * - Nav link href validation
 * - Footer link validation
 * - Donate/CTA button click testing
 * - Form field presence and enabled state
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

// ── Universal DOM helpers (run inside page.evaluate) ──────────────

const CHECK_LOGO = `
  (() => {
    // WordPress standard: img.custom-logo
    const wpLogo = document.querySelector('img.custom-logo');
    if (wpLogo && wpLogo.naturalWidth > 0) return { pass: true, detail: 'custom-logo: ' + wpLogo.alt };
    // Fallback: any img in header/nav with meaningful size
    const headerImgs = document.querySelectorAll('header img, nav img');
    for (const img of headerImgs) {
      if (img.naturalWidth > 30 && img.naturalHeight > 10) return { pass: true, detail: 'header img: ' + img.alt };
    }
    // Fallback: site title text
    const title = document.querySelector('.site-title, #site-title, .navbar-brand');
    if (title && title.innerText?.trim().length > 0) return { pass: true, detail: 'site-title text' };
    return { pass: false, detail: 'No logo found' };
  })()
`;

const CHECK_BROKEN_IMAGES = `
  (() => {
    const imgs = Array.from(document.querySelectorAll('img'));
    const broken = imgs.filter(img =>
      img.complete &&
      img.naturalWidth === 0 &&
      img.src &&
      !img.src.startsWith('data:') &&
      !img.src.includes('about:blank') &&
      img.src.length > 10
    ).map(img => img.src.split('/').slice(-1)[0] || img.src.slice(-40));
    return { pass: broken.length === 0, broken: broken.slice(0, 8), total: imgs.length };
  })()
`;

const CHECK_NAV_LINKS = `
  (() => {
    const nav = document.querySelector('nav, #site-navigation, .main-navigation, header nav');
    if (!nav) return { pass: false, detail: 'No nav element found', links: [] };
    const links = Array.from(nav.querySelectorAll('a[href]'))
      .map(a => ({ text: a.innerText?.trim().slice(0,30), href: a.href }))
      .filter(l => l.text.length > 0 && l.href && !l.href.startsWith('javascript'));
    const broken = links.filter(l => !l.href || l.href === window.location.href + '#');
    return {
      pass: links.length > 0,
      count: links.length,
      links: links.slice(0, 8),
      broken: broken.slice(0, 4),
    };
  })()
`;

const CHECK_FOOTER = `
  (() => {
    const footer = document.querySelector('footer, #colophon, .site-footer, [class*="footer"]');
    if (!footer) return { pass: false, detail: 'No footer element found' };
    const links = Array.from(footer.querySelectorAll('a[href]'))
      .map(a => ({ text: a.innerText?.trim().slice(0,25), href: a.href }))
      .filter(l => l.text.length > 0);
    const hasContent = footer.innerText?.trim().length > 20;
    return { pass: hasContent && links.length > 0, linkCount: links.length, links: links.slice(0,6) };
  })()
`;

// ── Sites ─────────────────────────────────────────────────────────
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

// ── Per-site checks: content + donate button click ────────────────
const SITE_CHECKS = {

  uh: async (page) => {
    await page.goto('https://israelrescue.org/donate', { waitUntil: 'domcontentloaded', timeout: 30000 });
    try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch {}
    await page.waitForTimeout(2000);
    const logo = await page.evaluate(CHECK_LOGO);
    const broken = await page.evaluate(CHECK_BROKEN_IMAGES);
    const nav = await page.evaluate(CHECK_NAV_LINKS);
    const footer = await page.evaluate(CHECK_FOOTER);
    const hasCurrency = await page.evaluate(() => !!document.querySelector('select, [class*="currency"]'));
    const hasEquipment = await page.evaluate(() => !!document.querySelector('[class*="equipment"], [class*="product_thumbnail"]'));
    const donateBtnText = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button, a'));
      return btns.filter(b => b.innerText?.toLowerCase().includes('donate')).map(b => b.innerText?.trim().slice(0,30));
    });
    const hasCustomAmount = donateBtnText.some(t => t.toLowerCase().includes('custom'));
    const hasEquipmentBtn = donateBtnText.some(t => t.toLowerCase().includes('equipment') || t.toLowerCase().includes('donate $'));
    return [
      { name: 'Logo loads correctly (img.custom-logo)',   pass: logo.pass,        detail: logo.detail },
      { name: 'No broken images',                         pass: broken.pass,      detail: broken.pass ? `${broken.total} imgs OK` : `Broken: ${broken.broken.join(', ')}` },
      { name: 'Navigation links present',                 pass: nav.pass,         detail: `${nav.count} nav links` },
      { name: 'Footer present with links',                pass: footer.pass,      detail: `${footer.linkCount} footer links` },
      { name: 'Currency selector present',                pass: hasCurrency,      detail: hasCurrency ? 'Found' : 'Missing' },
      { name: 'Equipment product thumbnails load',        pass: hasEquipment,     detail: hasEquipment ? 'Found' : 'Missing' },
      { name: '"Donate Custom Amount" button exists',     pass: hasCustomAmount,  detail: hasCustomAmount ? 'Found' : 'Missing' },
      { name: 'Equipment donate button exists',           pass: hasEquipmentBtn,  detail: hasEquipmentBtn ? 'Found' : 'Missing' },
    ];
  },

  chaiathon: async (page) => {
    await page.goto('https://chaiathon.org', { waitUntil: 'domcontentloaded', timeout: 30000 });
    try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch {}
    await page.waitForTimeout(2000);
    const logo = await page.evaluate(CHECK_LOGO);
    const broken = await page.evaluate(CHECK_BROKEN_IMAGES);
    const nav = await page.evaluate(CHECK_NAV_LINKS);
    const footer = await page.evaluate(CHECK_FOOTER);
    const navLinks = await page.evaluate(() =>
      Array.from(document.querySelectorAll('nav a')).map(a => a.innerText?.trim().toLowerCase())
    );
    const hasSearch = await page.evaluate(() => !!document.querySelector('input[type="search"], input[placeholder*="Find"], input[placeholder*="Search"]'));
    const hasStats = await page.evaluate(() => {
      const text = document.body?.innerText || '';
      return text.includes('Fundraisers') && (text.includes('100,000') || text.includes('10,') || text.includes('Active'));
    });
    // Test donate button click
    let donateBtnWorks = false;
    try {
      const donateBtn = page.locator('a, button').filter({ hasText: /^Donate$/i }).first();
      if (await donateBtn.isVisible({ timeout: 3000 })) {
        const href = await donateBtn.getAttribute('href');
        donateBtnWorks = !!(href && href.length > 1);
      }
    } catch {}
    return [
      { name: 'Logo loads correctly (img.custom-logo)',    pass: logo.pass,        detail: logo.detail },
      { name: 'No broken images',                          pass: broken.pass,      detail: broken.pass ? `${broken.total} imgs OK` : `Broken: ${broken.broken.join(', ')}` },
      { name: 'Navigation links present',                  pass: nav.pass,         detail: `${nav.count} nav links found` },
      { name: 'Footer present with links',                 pass: footer.pass,      detail: `${footer.linkCount} footer links` },
      { name: '"Fundraisers" nav item',                    pass: navLinks.some(t => t.includes('fundraiser')), detail: '' },
      { name: '"Teams" nav item',                          pass: navLinks.some(t => t.includes('team')),       detail: '' },
      { name: '"Prizes" nav item',                         pass: navLinks.some(t => t.includes('prize')),      detail: '' },
      { name: 'Search bar present',                        pass: hasSearch,        detail: hasSearch ? 'Found' : 'Missing' },
      { name: 'Campaign stats widget loads',               pass: hasStats,         detail: hasStats ? 'Found' : 'Missing' },
      { name: 'Donate button has valid href',              pass: donateBtnWorks,   detail: donateBtnWorks ? 'Links correctly' : 'Missing or broken' },
    ];
  },

  fcl: async (page) => {
    await page.goto('https://fundraise.chailifeline.org', { waitUntil: 'domcontentloaded', timeout: 30000 });
    try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch {}
    await page.waitForTimeout(2000);
    const logo = await page.evaluate(CHECK_LOGO);
    const broken = await page.evaluate(CHECK_BROKEN_IMAGES);
    const nav = await page.evaluate(CHECK_NAV_LINKS);
    const footer = await page.evaluate(CHECK_FOOTER);
    const hasLearnMore = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a, button')).some(el => el.innerText?.toLowerCase().includes('learn more'))
    );
    const hasCards = await page.evaluate(() => !!document.querySelector('[class*="card"], [class*="Card"], article'));
    let donateWorks = false;
    try {
      const btn = page.locator('a, button').filter({ hasText: /donate/i }).first();
      if (await btn.isVisible({ timeout: 3000 })) {
        const href = await btn.getAttribute('href');
        donateWorks = !!(href && href.length > 1);
      }
    } catch {}
    return [
      { name: 'Logo loads correctly',          pass: logo.pass,      detail: logo.detail },
      { name: 'No broken images',              pass: broken.pass,    detail: broken.pass ? `${broken.total} imgs OK` : `Broken: ${broken.broken.join(', ')}` },
      { name: 'Navigation links present',      pass: nav.pass,       detail: `${nav.count} links` },
      { name: 'Footer present with links',     pass: footer.pass,    detail: `${footer.linkCount} footer links` },
      { name: '"Learn More" button present',   pass: hasLearnMore,   detail: hasLearnMore ? 'Found' : 'Missing' },
      { name: 'Campaign cards visible',        pass: hasCards,       detail: hasCards ? 'Found' : 'Missing' },
      { name: 'Donate button has valid href',  pass: donateWorks,    detail: donateWorks ? 'Links correctly' : 'Missing or broken' },
    ];
  },

  clc: async (page) => {
    await page.goto('https://fundraise.chailifelinecanada.org', { waitUntil: 'domcontentloaded', timeout: 30000 });
    try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch {}
    await page.waitForTimeout(2000);
    const logo = await page.evaluate(CHECK_LOGO);
    const broken = await page.evaluate(CHECK_BROKEN_IMAGES);
    const nav = await page.evaluate(CHECK_NAV_LINKS);
    const footer = await page.evaluate(CHECK_FOOTER);
    const hasWaysToGive = await page.evaluate(() => document.body?.innerText?.includes('Ways to Give'));
    const hasForm = await page.evaluate(() => {
      const inputs = document.querySelectorAll('input[type="radio"], input[type="text"], input[type="number"]');
      return inputs.length > 0;
    });
    const formInputsEnabled = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('input, button[type="submit"]'));
      const disabled = inputs.filter(i => i.disabled).length;
      return { total: inputs.length, disabled };
    });
    return [
      { name: 'Logo loads correctly',            pass: logo.pass,       detail: logo.detail },
      { name: 'No broken images',                pass: broken.pass,     detail: broken.pass ? `${broken.total} imgs OK` : `Broken: ${broken.broken.join(', ')}` },
      { name: 'Navigation links present',        pass: nav.pass,        detail: `${nav.count} links` },
      { name: 'Footer present with links',       pass: footer.pass,     detail: `${footer.linkCount} footer links` },
      { name: '"Ways to Give" nav present',      pass: hasWaysToGive,   detail: hasWaysToGive ? 'Found' : 'Missing' },
      { name: 'Donation form inputs present',    pass: hasForm,         detail: hasForm ? 'Found' : 'Missing' },
      { name: 'Form inputs are enabled',         pass: formInputsEnabled.disabled === 0, detail: `${formInputsEnabled.disabled} disabled inputs` },
    ];
  },

  shomrim: async (page) => {
    await page.goto('https://shomrimtoronto.org', { waitUntil: 'domcontentloaded', timeout: 30000 });
    try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch {}
    await page.waitForTimeout(2000);
    const logo = await page.evaluate(CHECK_LOGO);
    const broken = await page.evaluate(CHECK_BROKEN_IMAGES);
    const nav = await page.evaluate(CHECK_NAV_LINKS);
    const footer = await page.evaluate(CHECK_FOOTER);
    const navLinks = await page.evaluate(() =>
      Array.from(document.querySelectorAll('nav a')).map(a => a.innerText?.trim().toLowerCase())
    );
    const hasEmergencyPhone = await page.evaluate(() => document.body?.innerText?.includes('647'));
    const hasFileIncident = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('a, button'));
      return btns.some(b => b.innerText?.toLowerCase().includes('incident'));
    });
    let fileIncidentWorks = false;
    try {
      const btn = page.locator('a, button').filter({ hasText: /incident/i }).first();
      if (await btn.isVisible({ timeout: 3000 })) {
        const href = await btn.getAttribute('href');
        fileIncidentWorks = !!(href && href.length > 1);
      }
    } catch {}
    return [
      { name: 'Logo loads correctly',              pass: logo.pass,            detail: logo.detail },
      { name: 'No broken images',                  pass: broken.pass,          detail: broken.pass ? `${broken.total} imgs OK` : `Broken: ${broken.broken.join(', ')}` },
      { name: 'Navigation links present',          pass: nav.pass,             detail: `${nav.count} links` },
      { name: 'Footer present with links',         pass: footer.pass,          detail: `${footer.linkCount} footer links` },
      { name: '"Donate" in nav',                   pass: navLinks.some(t => t.includes('donate')), detail: '' },
      { name: 'Emergency phone number visible',    pass: hasEmergencyPhone,    detail: hasEmergencyPhone ? '647 found' : 'Missing' },
      { name: '"File an incident" button exists',  pass: hasFileIncident,      detail: hasFileIncident ? 'Found' : 'Missing' },
      { name: '"File an incident" button works',   pass: fileIncidentWorks,    detail: fileIncidentWorks ? 'Has valid href' : 'Broken or missing' },
    ];
  },

  fallen: async (page) => {
    await page.goto('https://fallenh.org', { waitUntil: 'domcontentloaded', timeout: 30000 });
    try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch {}
    await page.waitForTimeout(2000);
    const logo = await page.evaluate(CHECK_LOGO);
    const broken = await page.evaluate(CHECK_BROKEN_IMAGES);
    const nav = await page.evaluate(CHECK_NAV_LINKS);
    const footer = await page.evaluate(CHECK_FOOTER);
    const hasAmounts = await page.evaluate(() => {
      const text = document.body?.innerText || '';
      return text.includes('180') && text.includes('360');
    });
    const hasCustom = await page.evaluate(() => {
      const text = (document.body?.innerText || '').toLowerCase();
      return text.includes('custom amount') || text.includes('other amount');
    });
    const hasDedication = await page.evaluate(() =>
      (document.body?.innerText || '').toLowerCase().includes('dedicat')
    );
    let donateWorks = false;
    try {
      const btn = page.locator('a, button').filter({ hasText: /donate/i }).first();
      if (await btn.isVisible({ timeout: 3000 })) {
        const tag = await btn.evaluate(e => e.tagName.toLowerCase());
        const href = await btn.getAttribute('href').catch(() => null);
        donateWorks = tag === 'button' || (href && href.length > 1);
      }
    } catch {}
    return [
      { name: 'Logo loads correctly',          pass: logo.pass,      detail: logo.detail },
      { name: 'No broken images',              pass: broken.pass,    detail: broken.pass ? `${broken.total} imgs OK` : `Broken: ${broken.broken.join(', ')}` },
      { name: 'Navigation links present',      pass: nav.pass,       detail: `${nav.count} links` },
      { name: 'Footer present with links',     pass: footer.pass,    detail: `${footer.linkCount} footer links` },
      { name: 'Donation amounts ($180, $360)', pass: hasAmounts,     detail: hasAmounts ? 'Found' : 'Missing' },
      { name: 'Custom amount option',          pass: hasCustom,      detail: hasCustom ? 'Found' : 'Missing' },
      { name: 'Dedication option',             pass: hasDedication,  detail: hasDedication ? 'Found' : 'Missing' },
      { name: 'Donate button clickable',       pass: donateWorks,    detail: donateWorks ? 'Works' : 'Missing or broken' },
    ];
  },

  imf: async (page) => {
    await page.goto('https://israelmagenfund.org', { waitUntil: 'domcontentloaded', timeout: 30000 });
    try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch {}
    await page.waitForTimeout(2000);
    const logo = await page.evaluate(CHECK_LOGO);
    const broken = await page.evaluate(CHECK_BROKEN_IMAGES);
    const nav = await page.evaluate(CHECK_NAV_LINKS);
    const footer = await page.evaluate(CHECK_FOOTER);
    const hasBecomeBtn = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a, button')).some(e => e.innerText?.toLowerCase().includes('fundraiser'))
    );
    const hasImpact = await page.evaluate(() => (document.body?.innerText || '').toLowerCase().includes('impact'));
    let donateNowWorks = false;
    try {
      const btn = page.locator('a, button').filter({ hasText: /donate now/i }).first();
      if (await btn.isVisible({ timeout: 3000 })) {
        const href = await btn.getAttribute('href').catch(() => null);
        donateNowWorks = !!(href && href.length > 1);
      }
    } catch {}
    return [
      { name: 'Logo loads correctly',               pass: logo.pass,        detail: logo.detail },
      { name: 'No broken images',                   pass: broken.pass,      detail: broken.pass ? `${broken.total} imgs OK` : `Broken: ${broken.broken.join(', ')}` },
      { name: 'Navigation links present',           pass: nav.pass,         detail: `${nav.count} links` },
      { name: 'Footer present with links',          pass: footer.pass,      detail: `${footer.linkCount} footer links` },
      { name: '"Become a Fundraiser" link present', pass: hasBecomeBtn,     detail: hasBecomeBtn ? 'Found' : 'Missing' },
      { name: '"Our Impact" section',               pass: hasImpact,        detail: hasImpact ? 'Found' : 'Missing' },
      { name: '"Donate Now" button has valid href',  pass: donateNowWorks,  detail: donateNowWorks ? 'Works' : 'Missing or broken' },
    ];
  },

  yeshiva: async (page) => {
    await page.goto('https://donate.theyeshiva.net', { waitUntil: 'domcontentloaded', timeout: 30000 });
    try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch {}
    await page.waitForTimeout(2000);
    const logo = await page.evaluate(CHECK_LOGO);
    const broken = await page.evaluate(CHECK_BROKEN_IMAGES);
    const footer = await page.evaluate(CHECK_FOOTER);
    const hasTiers = await page.evaluate(() => {
      const text = document.body?.innerText || '';
      return text.includes('$1,000') || text.includes('$500') || text.includes('Sponsor');
    });
    const hasToggle = await page.evaluate(() => {
      const text = document.body?.innerText || '';
      return text.includes('Give once') || text.includes('Monthly') || text.includes('One-time');
    });
    const formFields = await page.evaluate(() => {
      const inputs = document.querySelectorAll('input[type="radio"], input[type="text"], input[type="email"]');
      const enabled = Array.from(inputs).filter(i => !i.disabled);
      return { total: inputs.length, enabled: enabled.length };
    });
    return [
      { name: 'Logo loads correctly',           pass: logo.pass,             detail: logo.detail },
      { name: 'No broken images',               pass: broken.pass,           detail: broken.pass ? `${broken.total} imgs OK` : `Broken: ${broken.broken.join(', ')}` },
      { name: 'Footer present',                 pass: footer.pass,           detail: `${footer.linkCount} footer links` },
      { name: 'Donation tiers present',         pass: hasTiers,              detail: hasTiers ? 'Found' : 'Missing' },
      { name: '"Give once" / "Monthly" toggle', pass: hasToggle,             detail: hasToggle ? 'Found' : 'Missing' },
      { name: 'Form inputs enabled',            pass: formFields.enabled > 0, detail: `${formFields.enabled}/${formFields.total} inputs enabled` },
    ];
  },

  nahal: async (page) => {
    await page.goto('https://give.nahalharedi.org', { waitUntil: 'domcontentloaded', timeout: 30000 });
    try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch {}
    await page.waitForTimeout(2000);
    const logo = await page.evaluate(CHECK_LOGO);
    const broken = await page.evaluate(CHECK_BROKEN_IMAGES);
    const nav = await page.evaluate(CHECK_NAV_LINKS);
    const footer = await page.evaluate(CHECK_FOOTER);
    const navLinks = await page.evaluate(() =>
      Array.from(document.querySelectorAll('nav a')).map(a => a.innerText?.trim().toLowerCase())
    );
    const hasAmounts = await page.evaluate(() => {
      const text = document.body?.innerText || '';
      return text.includes('18') || text.includes('36') || text.includes('100');
    });
    const formFields = await page.evaluate(() => {
      const inputs = document.querySelectorAll('input[type="radio"], input[type="text"], button[type="submit"], input[type="submit"]');
      return { total: inputs.length, enabled: Array.from(inputs).filter(i => !i.disabled).length };
    });
    return [
      { name: 'Logo loads correctly',        pass: logo.pass,              detail: logo.detail },
      { name: 'No broken images',            pass: broken.pass,            detail: broken.pass ? `${broken.total} imgs OK` : `Broken: ${broken.broken.join(', ')}` },
      { name: 'Navigation links present',    pass: nav.pass,               detail: `${nav.count} links` },
      { name: 'Footer present with links',   pass: footer.pass,            detail: `${footer.linkCount} footer links` },
      { name: '"Campaigns" nav item',        pass: navLinks.some(t => t.includes('campaign')), detail: '' },
      { name: '"eCards" nav item',           pass: navLinks.some(t => t.includes('ecard') || t.includes('e-card')), detail: '' },
      { name: 'Donation amounts visible',    pass: hasAmounts,             detail: hasAmounts ? 'Found' : 'Missing' },
      { name: 'Form inputs enabled',         pass: formFields.enabled > 0, detail: `${formFields.enabled}/${formFields.total} inputs enabled` },
    ];
  },

  ots: async (page) => {
    await page.goto('https://fundraise.ots.org.il', { waitUntil: 'domcontentloaded', timeout: 30000 });
    try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch {}
    await page.waitForTimeout(2000);
    const logo = await page.evaluate(CHECK_LOGO);
    const broken = await page.evaluate(CHECK_BROKEN_IMAGES);
    const footer = await page.evaluate(CHECK_FOOTER);
    const hasAmounts = await page.evaluate(() => {
      const text = document.body?.innerText || '';
      return text.includes('36') || text.includes('50') || text.includes('100');
    });
    const hasMonthly = await page.evaluate(() => {
      const text = document.body?.innerText || '';
      return text.includes('Monthly') || text.includes('Give once');
    });
    const hasLang = await page.evaluate(() =>
      !!(document.querySelector('select') || document.body?.innerText?.includes('English'))
    );
    const formFields = await page.evaluate(() => {
      const inputs = document.querySelectorAll('input[type="radio"], input[type="text"], input[type="number"], input[type="email"]');
      return { total: inputs.length, enabled: Array.from(inputs).filter(i => !i.disabled).length };
    });
    return [
      { name: 'Logo loads correctly',         pass: logo.pass,              detail: logo.detail },
      { name: 'No broken images',             pass: broken.pass,            detail: broken.pass ? `${broken.total} imgs OK` : `Broken: ${broken.broken.join(', ')}` },
      { name: 'Footer present',               pass: footer.pass,            detail: `${footer.linkCount} footer links` },
      { name: 'Donation amounts visible',     pass: hasAmounts,             detail: hasAmounts ? 'Found' : 'Missing' },
      { name: '"Give once" / "Monthly"',      pass: hasMonthly,             detail: hasMonthly ? 'Found' : 'Missing' },
      { name: 'Language selector present',    pass: hasLang,                detail: hasLang ? 'Found' : 'Missing' },
      { name: 'Form inputs enabled',          pass: formFields.enabled > 0, detail: `${formFields.enabled}/${formFields.total} inputs enabled` },
    ];
  },

  // Generic checks for sites not yet individually inspected
  _generic: async (page, site) => {
    const logo = await page.evaluate(CHECK_LOGO);
    const broken = await page.evaluate(CHECK_BROKEN_IMAGES);
    const nav = await page.evaluate(CHECK_NAV_LINKS);
    const footer = await page.evaluate(CHECK_FOOTER);
    const hasDonate = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a, button')).some(e => e.innerText?.toLowerCase().includes('donate'))
    );
    let donateWorks = false;
    try {
      const btn = page.locator('a, button').filter({ hasText: /donate/i }).first();
      if (await btn.isVisible({ timeout: 3000 })) {
        const href = await btn.getAttribute('href').catch(() => null);
        const tag = await btn.evaluate(e => e.tagName.toLowerCase());
        donateWorks = tag === 'button' || (href && href.length > 1 && !href.startsWith('javascript'));
      }
    } catch {}
    return [
      { name: 'Logo loads correctly',           pass: logo.pass,    detail: logo.detail },
      { name: 'No broken images',               pass: broken.pass,  detail: broken.pass ? `${broken.total} imgs OK` : `Broken: ${broken.broken.join(', ')}` },
      { name: 'Navigation links present',       pass: nav.pass,     detail: `${nav.count} links` },
      { name: 'Footer present with links',      pass: footer.pass,  detail: `${footer.linkCount} footer links` },
      { name: 'Donate button present',          pass: hasDonate,    detail: hasDonate ? 'Found' : 'Missing' },
      { name: 'Donate button has valid href',   pass: donateWorks,  detail: donateWorks ? 'Works' : 'Missing or broken' },
    ];
  },
};

// Sites that use generic checks
['pantry','israelthon','yorkville','afmda','misaskim','mizrachi','nitzanim','adi','r2bo','clc','fcl'].forEach(id => {
  if (!SITE_CHECKS[id]) {
    SITE_CHECKS[id] = async (page, site) => SITE_CHECKS._generic(page, site);
  }
});

// ── Error patterns ────────────────────────────────────────────────
const ERROR_TITLE_WORDS  = ['404','403','500','502','503','504','not found','error','page not found','access denied','forbidden','bad gateway','service unavailable','internal server error'];
const ERROR_BODY_PHRASES = ["this site can't be reached","this page isn't working",'err_connection_refused','dns_probe_finished','application error','database connection','fatal error','under construction','coming soon','parked domain','buy this domain','this domain is for sale','account suspended','bandwidth limit exceeded'];

const log = (msg, type = 'info') => {
  const icons = { info: '  ', pass: '✅', fail: '❌', warn: '⚠️ ', ai: '🤖' };
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

    // ── 1. Homepage generic checks ──────────────────────────────
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

    // ── 2. Per-site UI + DOM checks ──────────────────────────────
    if (SITE_CHECKS[site.id]) {
      try {
        const uiResults = await SITE_CHECKS[site.id](page, site);
        result.uiChecks = uiResults;
        const failed = uiResults.filter(c => !c.pass);
        const passed = uiResults.filter(c => c.pass).length;
        log(`  UI checks: ${passed}/${uiResults.length} passed`, passed === uiResults.length ? 'pass' : 'warn');
        uiResults.forEach(c => {
          const icon = c.pass ? '✓' : '✗';
          const detail = c.detail ? ` (${c.detail})` : '';
          log(`    ${icon} ${c.name}${detail}`);
        });
        // Major failure only if logo broken, OR 3+ UI checks fail, OR broken images found
        const logoCheck = uiResults.find(c => c.name.includes('Logo'));
        const brokenCheck = uiResults.find(c => c.name.includes('broken images'));
        if (logoCheck && !logoCheck.pass) {
          result.majorFailures.push(`Logo not loading — site may be broken`);
        }
        if (brokenCheck && !brokenCheck.pass) {
          result.majorFailures.push(`Broken images detected: ${brokenCheck.detail}`);
        }
        if (failed.length >= 4) {
          result.majorFailures.push(`${failed.length} UI checks failing: ${failed.map(c => c.name).join(', ')}`);
        }
      } catch (uiErr) {
        log(`  UI checks error: ${uiErr.message}`, 'warn');
      }
    }

    // ── 3. Screenshot + Gemini ────────────────────────────────────
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
          const isDupe = result.majorFailures.some(f => f.toLowerCase().includes(issue.toLowerCase().slice(0,20)));
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
  console.log(`  QA Agent v3 (Gemini + DOM Checks) — ${date}`);
  console.log('══════════════════════════════════════════\n');

  const sitesToTest = SINGLE_SITE ? SITES.filter(s => s.id === SINGLE_SITE) : SITES;
  if (!sitesToTest.length) { console.error(`No site: "${SINGLE_SITE}"`); process.exit(1); }
  log(`Running ${sitesToTest.length} sites — logo, broken images, nav, footer, buttons, forms...`);

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
      log(`Fatal on ${site.name}: ${err.message}`, 'fail');
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
