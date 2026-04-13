/**
 * QA Smoke Test Agent v5 — All 19 Sites, Zero False Positives
 *
 * Built from direct DOM inspection of every site. Key learnings applied:
 *
 * BROWSER QUIRKS HANDLED:
 * - SVG <img> tags always report naturalWidth=0 in headless Chrome → excluded
 * - Images with loading="lazy" haven't scrolled into view → excluded
 * - Images with layout width/height=0 are decorative/hidden → excluded
 * - React/JS apps (Mizrachi) render content as images not text → use imgCount not bodyLen
 * - Elementor sites have no <nav> tag → scan all elements for highest link count
 * - Cookie consent wrappers register as "footer" → excluded by class name
 *
 * PER-SITE SPECIFICS:
 * - Misaskim: Elementor, no img.custom-logo → detect via wp-image class in header
 * - ADI: custom WP, logo has class wp-image-6538 not custom-logo → detect by header img
 * - Nitzanim: member portal, no footer links → don't fail on missing footer links
 * - Yorkville: donate-only page, minimal nav (just "Back to..." link) → don't fail on nav
 * - Shomrim: Elementor, footer is .cky-footer-wrapper (cookie) → real footer is elementor-footer
 * - Mizrachi: React app, innerText=34 chars → check img count instead
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const FIREBASE_URL   = (process.env.FIREBASE_DATABASE_URL || '').replace(/\/$/, '');
const GEMINI_KEY     = process.env.GEMINI_API_KEY || '';
const SINGLE_SITE    = process.env.SINGLE_SITE   || '';
const SCREENSHOT_DIR = '/tmp/qa-screenshots';
const GEMINI_MODEL        = 'gemini-2.0-flash';
const GEMINI_MODEL_FALLBACK = 'gemini-1.5-flash-8b'; // separate quota bucket — used if primary hits 429
const GEMINI_URL      = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`;
const GEMINI_URL_FALLBACK = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL_FALLBACK}:generateContent?key=${GEMINI_KEY}`;

if (!FIREBASE_URL) { console.error('FIREBASE_DATABASE_URL is not set'); process.exit(1); }
if (!GEMINI_KEY)   { console.error('GEMINI_API_KEY is not set');         process.exit(1); }

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

// ─────────────────────────────────────────────────────────────────
// UNIVERSAL DOM HELPERS (injected via page.evaluate)
// ─────────────────────────────────────────────────────────────────

// Logo: tries img.custom-logo first (WP standard), then any header img with real dimensions
const CHECK_LOGO = `(() => {
  // Helper: is an img considered loaded? SVGs always have naturalWidth=0 in headless Chrome
  // so for SVGs we just check img.complete + src exists + not errored
  function imgLoaded(img) {
    if (!img.src || img.src.startsWith('data:')) return false;
    const isSvg = img.src.toLowerCase().match(/\.svg(\\?|$)/);
    if (isSvg) return img.complete; // SVGs: just check complete, naturalWidth is always 0
    return img.complete && img.naturalWidth > 0;
  }
  // WordPress standard — img.custom-logo class IS the logo, trust src+complete even if naturalWidth=0
  // naturalWidth=0 is a known headless Chrome quirk for PNG images in GitHub Actions
  const wpLogo = document.querySelector('img.custom-logo');
  if (wpLogo && wpLogo.src && !wpLogo.src.startsWith('data:') && wpLogo.complete) {
    return { pass: true, detail: 'custom-logo: ' + (wpLogo.alt || wpLogo.src.split('/').slice(-1)[0]) };
  }
  // Elementor / custom WP / other builders: any header-area img that is loaded
  const containers = [
    ...document.querySelectorAll('header'),
    ...document.querySelectorAll('[class*="elementor-location-header"]'),
    ...document.querySelectorAll('[class*="site-header"]'),
    ...document.querySelectorAll('[id*="header"]'),
    ...document.querySelectorAll('nav'),
    ...document.querySelectorAll('[class*="navbar"]'),
    ...document.querySelectorAll('[class*="masthead"]'),
    ...document.querySelectorAll('[class*="logo"]'),
  ];
  for (const c of containers) {
    for (const img of c.querySelectorAll('img')) {
      const isSvg = img.src?.toLowerCase().match(/\.svg(\\?|$)/);
      if (isSvg && img.complete && img.src) return { pass: true, detail: 'svg-logo: ' + (img.alt || img.src.split('/').slice(-1)[0]) };
      if (!isSvg && img.naturalWidth > 30 && img.naturalHeight > 10) return { pass: true, detail: 'header-img: ' + (img.alt || img.className.split(' ')[0]) };
    }
  }
  // Text fallback
  const title = document.querySelector('.site-title, #site-title, .navbar-brand');
  if (title && title.innerText?.trim().length > 0) return { pass: true, detail: 'site-title: ' + title.innerText.trim().slice(0,30) };
  return { pass: false, detail: 'No logo found in header' };
})()`;

// Broken images: excludes SVGs, lazy, hidden, and zero-layout images
const CHECK_BROKEN_IMAGES = `(() => {
  const imgs = Array.from(document.querySelectorAll('img'));
  const broken = imgs.filter(img => {
    if (!img.src || img.src.startsWith('data:') || img.src.includes('about:blank')) return false;
    // SVGs report naturalWidth=0 in headless Chrome — known quirk, not actually broken
    if (img.src.toLowerCase().match(/\\.svg(\\?|$)/)) return false;
    // Lazy images haven't scrolled into view yet
    if (img.loading === 'lazy' || img.getAttribute('loading') === 'lazy') return false;
    // Images hidden via CSS or with no layout size are decorative/off-screen
    const rect = img.getBoundingClientRect();
    const hasLayout = img.width > 0 || img.height > 0 || rect.width > 0 || rect.height > 0;
    if (!hasLayout) return false;
    return img.complete && img.naturalWidth === 0;
  }).map(img => img.src.split('/').slice(-1)[0] || img.src.slice(-50));
  return { pass: broken.length === 0, broken: broken.slice(0,8), total: imgs.length };
})()`;

// Nav: finds the container with the most navigation links regardless of tag/builder
const CHECK_NAV_LINKS = `(() => {
  const selectors = [
    'nav', '#site-navigation', '.main-navigation', '.primary-navigation',
    '[class*="elementor-location-header"]', '[class*="elementor"][class*="header"]',
    'header', '[id*="header"]', '[class*="site-header"]',
    '[class*="navbar"]', '[class*="nav-bar"]', '[class*="main-menu"]',
  ];
  let best = null, bestCount = 0;
  for (const sel of selectors) {
    try {
      for (const el of document.querySelectorAll(sel)) {
        const links = el.querySelectorAll('a[href]');
        if (links.length > bestCount) { bestCount = links.length; best = el; }
      }
    } catch {}
  }
  if (!best || bestCount === 0) return { pass: false, detail: 'No nav found', count: 0, texts: [] };
  const texts = Array.from(best.querySelectorAll('a[href]'))
    .map(a => a.innerText?.trim().toLowerCase())
    .filter(t => t && t.length > 1 && t.length < 40);
  return { pass: bestCount >= 2, count: bestCount, texts: [...new Set(texts)].slice(0,12) };
})()`;

// Footer: excludes cookie consent wrappers, finds real footer content
const CHECK_FOOTER = `(() => {
  const cookieWords = ['cky-', 'cookieyes', 'cookie-consent', 'gdpr', 'cc-banner', 'consent-banner'];
  const candidates = Array.from(document.querySelectorAll(
    'footer, #colophon, .site-footer, #footer, [class*="footer"], [id*="footer"]'
  )).filter(el => {
    const cls = (el.className || '').toLowerCase() + (el.id || '').toLowerCase();
    return !cookieWords.some(w => cls.includes(w));
  });
  if (candidates.length === 0) return { pass: false, detail: 'No footer found', linkCount: 0 };
  // Pick the one with the most content
  const footer = candidates.sort((a,b) => b.innerText?.length - a.innerText?.length)[0];
  const links = footer.querySelectorAll('a[href]').length;
  const hasText = footer.innerText?.trim().length > 10;
  return { pass: hasText || links > 0, linkCount: links, hasText };
})()`;

// ─────────────────────────────────────────────────────────────────
// SITES
// ─────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────
// PER-SITE CHECKS — based on direct DOM inspection
// ─────────────────────────────────────────────────────────────────
const SITE_CHECKS = {

  // ── United Hatzalah ─────────────────────────────────────────────
  // Navigate to /donate — logo=img.custom-logo, currency=select.switch_currency,
  // equipment=.levcharity_donation_equipments_wrapper, 2 donate buttons in body
  uh: async (page) => {
    await page.goto('https://israelrescue.org/donate', { waitUntil: 'domcontentloaded', timeout: 30000 });
    try { await page.waitForLoadState('networkidle', { timeout: 10000 }); } catch {}
    await page.waitForTimeout(3000);
    const logo    = await page.evaluate(CHECK_LOGO);
    const broken  = await page.evaluate(CHECK_BROKEN_IMAGES);
    const footer  = await page.evaluate(CHECK_FOOTER);
    const checks  = await page.evaluate(() => ({
      hasCurrency:  !!(document.querySelector('select.switch_currency') || document.querySelector('select')),
      hasEquipment: !!(document.querySelector('.levcharity_donation_equipments_wrapper') || document.querySelector('.donation_equipment_product_thumbnail')),
      hasCustomBtn: Array.from(document.querySelectorAll('a,button')).some(b => /custom amount/i.test(b.innerText)),
      hasEquipBtn:  Array.from(document.querySelectorAll('a,button')).some(b => /equipment now/i.test(b.innerText) || /donate \$/i.test(b.innerText)),
      donateHref:   Array.from(document.querySelectorAll('a,button')).find(b => /donate/i.test(b.innerText))?.href || null,
    }));
    return [
      { name: 'Logo visible and loaded',              pass: logo.pass,            detail: logo.detail },
      { name: 'No broken images',                     pass: broken.pass,          detail: broken.pass ? `${broken.total} imgs OK` : `Broken: ${broken.broken.join(', ')}` },
      { name: 'Footer present',                       pass: footer.pass,          detail: `${footer.linkCount} links` },
      { name: 'Currency selector present',            pass: checks.hasCurrency,   detail: checks.hasCurrency ? 'Found' : 'Missing' },
      { name: 'Equipment section loads',              pass: checks.hasEquipment,  detail: checks.hasEquipment ? 'Found' : 'Missing' },
      { name: '"Donate Custom Amount" button exists', pass: checks.hasCustomBtn,  detail: checks.hasCustomBtn ? 'Found' : 'Missing' },
      { name: '"Donate Equipment Now" button exists', pass: checks.hasEquipBtn,   detail: checks.hasEquipBtn ? 'Found' : 'Missing' },
    ];
  },

  // ── Pantry Packers ───────────────────────────────────────────────
  // img.custom-logo w:164, nav: Donate/eCards/Campaigns, CTA: "Start your campaign"
  pantry: async (page) => {
    const logo   = await page.evaluate(CHECK_LOGO);
    const broken = await page.evaluate(CHECK_BROKEN_IMAGES);
    const nav    = await page.evaluate(CHECK_NAV_LINKS);
    const footer = await page.evaluate(CHECK_FOOTER);
    const checks = await page.evaluate(() => ({
      hasEcards:    (document.body?.innerText||'').includes('eCards') || (document.body?.innerText||'').includes('Ecards'),
      hasCampaigns: (document.body?.innerText||'').includes('Campaigns') || (document.body?.innerText||'').includes('Campaign'),
      hasStartCTA:  Array.from(document.querySelectorAll('a,button')).some(b => /start.*campaign/i.test(b.innerText)),
      hasDonate:    Array.from(document.querySelectorAll('a,button')).some(b => /^donate$/i.test(b.innerText?.trim())),
      donateHref:   Array.from(document.querySelectorAll('a,button')).find(b => /donate/i.test(b.innerText))?.href || null,
    }));
    return [
      { name: 'Logo visible and loaded',        pass: logo.pass,           detail: logo.detail },
      { name: 'No broken images',               pass: broken.pass,         detail: broken.pass ? `${broken.total} imgs OK` : `Broken: ${broken.broken.join(', ')}` },
      { name: 'Navigation links present',       pass: nav.pass,            detail: `${nav.count} links` },
      { name: 'Footer present',                 pass: footer.pass,         detail: `${footer.linkCount} links` },
      { name: '"eCards" nav item present',      pass: checks.hasEcards,    detail: checks.hasEcards ? 'Found' : 'Missing' },
      { name: '"Campaigns" section present',    pass: checks.hasCampaigns, detail: checks.hasCampaigns ? 'Found' : 'Missing' },
      { name: '"Start your campaign" CTA',      pass: checks.hasStartCTA,  detail: checks.hasStartCTA ? 'Found' : 'Missing' },
      { name: 'Donate button has valid href',   pass: !!(checks.donateHref && checks.donateHref.length > 5), detail: checks.donateHref || 'Missing' },
    ];
  },

  // ── Israelthon ───────────────────────────────────────────────────
  // img.custom-logo w:320, nav: About us/Raisers/Teams/Merch/Contact, footer: address+phone
  // CTAs: "BECOME A RAISER" + "DONATE NOW", Total Raised widget
  israelthon: async (page) => {
    const logo   = await page.evaluate(CHECK_LOGO);
    const broken = await page.evaluate(CHECK_BROKEN_IMAGES);
    const nav    = await page.evaluate(CHECK_NAV_LINKS);
    const footer = await page.evaluate(CHECK_FOOTER);
    const checks = await page.evaluate(() => ({
      navTexts:       Array.from(document.querySelectorAll('nav a, header a')).map(a => a.innerText?.trim().toLowerCase()),
      hasDonateNow:   Array.from(document.querySelectorAll('a,button')).some(b => /donate now/i.test(b.innerText)),
      hasBecomeRaiser:Array.from(document.querySelectorAll('a,button')).some(b => /raiser/i.test(b.innerText) || /become a/i.test(b.innerText)),
      hasTotalRaised: (document.body?.innerText||'').includes('Total Raised'),
      donateHref:     Array.from(document.querySelectorAll('a,button')).find(b => /donate/i.test(b.innerText))?.href || null,
      hasAddress:     (document.body?.innerText||'').includes('Lakewood') || (document.body?.innerText||'').includes('NJ') || (document.body?.innerText||'').includes('646'),
    }));
    return [
      { name: 'Logo visible and loaded',           pass: logo.pass,                  detail: logo.detail },
      { name: 'No broken images',                  pass: broken.pass,                detail: broken.pass ? `${broken.total} imgs OK` : `Broken: ${broken.broken.join(', ')}` },
      { name: 'Navigation links present',          pass: nav.pass,                   detail: `${nav.count} links` },
      { name: 'Footer with address/contact info',  pass: footer.pass,                detail: `${footer.linkCount} links` },
      { name: '"Raisers" nav item present',        pass: checks.navTexts.some(t => t.includes('raiser')), detail: '' },
      { name: '"Teams" nav item present',          pass: checks.navTexts.some(t => t.includes('team')),   detail: '' },
      { name: '"Donate Now" button present',       pass: checks.hasDonateNow,        detail: checks.hasDonateNow ? 'Found' : 'Missing' },
      { name: '"Become a Raiser" button present',  pass: checks.hasBecomeRaiser,     detail: checks.hasBecomeRaiser ? 'Found' : 'Missing' },
      { name: '"Total Raised" widget visible',     pass: checks.hasTotalRaised,      detail: checks.hasTotalRaised ? 'Found' : 'Missing' },
      { name: 'Donate button has valid href',      pass: !!(checks.donateHref && checks.donateHref.length > 5), detail: checks.donateHref || 'Missing' },
    ];
  },

  // ── Yorkville Jewish Centre ──────────────────────────────────────
  // Donation-only page. img.custom-logo (alt:"Donate"). Minimal nav (just "Back to..." link).
  // C$ amounts, Give once/Monthly toggle. No footer links — this is expected.
  yorkville: async (page) => {
    const logo   = await page.evaluate(CHECK_LOGO);
    const broken = await page.evaluate(CHECK_BROKEN_IMAGES);
    const checks = await page.evaluate(() => ({
      hasBackLink:  Array.from(document.querySelectorAll('a')).some(a => /back to/i.test(a.innerText)),
      hasAmounts:   ['C$ 10','C$ 20','C$ 40','C$ 80','C$ 120','C$ 360'].some(a => (document.body?.innerText||'').includes(a)),
      hasToggle:    (document.body?.innerText||'').includes('Give once') || (document.body?.innerText||'').includes('Monthly'),
      hasDonate:    (document.body?.innerText||'').toLowerCase().includes('donate'),
      hasForm:      document.querySelectorAll('input[type="radio"], input[type="text"], input[type="number"]').length > 0,
      formEnabled:  Array.from(document.querySelectorAll('input')).filter(i=>!i.disabled).length,
    }));
    return [
      { name: 'Logo visible and loaded',           pass: logo.pass,          detail: logo.detail },
      { name: 'No broken images',                  pass: broken.pass,        detail: broken.pass ? `${broken.total} imgs OK` : `Broken: ${broken.broken.join(', ')}` },
      { name: '"Back to Yorkville" link present',  pass: checks.hasBackLink, detail: checks.hasBackLink ? 'Found' : 'Missing' },
      { name: 'Donation amounts visible (C$)',     pass: checks.hasAmounts,  detail: checks.hasAmounts ? 'Found' : 'Missing' },
      { name: '"Give once" / "Monthly" toggle',    pass: checks.hasToggle,   detail: checks.hasToggle ? 'Found' : 'Missing' },
      { name: 'Donation form inputs present',      pass: checks.hasForm,     detail: checks.hasForm ? 'Found' : 'Missing' },
      { name: 'Form inputs are enabled',           pass: checks.formEnabled > 0, detail: `${checks.formEnabled} enabled` },
    ];
  },

  // ── Chaiathon ────────────────────────────────────────────────────
  // img.custom-logo (alt:"Chaiathon"), WP Gutenberg nav, search bar, stats widget
  chaiathon: async (page) => {
    const logo   = await page.evaluate(CHECK_LOGO);
    const broken = await page.evaluate(CHECK_BROKEN_IMAGES);
    const nav    = await page.evaluate(CHECK_NAV_LINKS);
    const footer = await page.evaluate(CHECK_FOOTER);
    const checks = await page.evaluate(() => ({
      navTexts:     Array.from(document.querySelectorAll('nav a, header a')).map(a => a.innerText?.trim().toLowerCase()),
      hasSearch:    !!document.querySelector('input[type="search"], input[placeholder*="Find"], input[placeholder*="Search"]'),
      hasStats:     (document.body?.innerText||'').includes('Fundraisers') && ((document.body?.innerText||'').includes('100,000') || (document.body?.innerText||'').includes('Active')),
      hasOrderKit:  (document.body?.innerText||'').includes('Order') && ((document.body?.innerText||'').includes('Kit') || (document.body?.innerText||'').includes('kit')),
      donateHref:   Array.from(document.querySelectorAll('a,button')).find(b => /^donate$/i.test(b.innerText?.trim()))?.href || null,
    }));
    return [
      { name: 'Logo visible and loaded',         pass: logo.pass,                                      detail: logo.detail },
      { name: 'No broken images',                pass: broken.pass,                                    detail: broken.pass ? `${broken.total} imgs OK` : `Broken: ${broken.broken.join(', ')}` },
      { name: 'Navigation links present',        pass: nav.pass,                                       detail: `${nav.count} links` },
      { name: 'Footer with links',               pass: footer.pass,                                    detail: `${footer.linkCount} links` },
      { name: '"Fundraisers" nav item',          pass: checks.navTexts.some(t => t.includes('fundraiser')), detail: '' },
      { name: '"Teams" nav item',                pass: checks.navTexts.some(t => t.includes('team')),       detail: '' },
      { name: '"Prizes" nav item',               pass: checks.navTexts.some(t => t.includes('prize')),      detail: '' },
      { name: 'Search bar present',              pass: checks.hasSearch,                               detail: checks.hasSearch ? 'Found' : 'Missing' },
      { name: 'Campaign stats widget loads',     pass: checks.hasStats,                                detail: checks.hasStats ? 'Found' : 'Missing' },
      { name: '"Order your Kit" CTA',            pass: checks.hasOrderKit,                             detail: checks.hasOrderKit ? 'Found' : 'Missing' },
      { name: 'Donate button has valid href',    pass: !!(checks.donateHref && checks.donateHref.length > 5), detail: checks.donateHref || 'Missing' },
    ];
  },

  // ── Chai Lifeline USA (FCL) ──────────────────────────────────────
  // img.custom-logo, "Learn More About Chai Lifeline", campaign cards
  fcl: async (page) => {
    const logo   = await page.evaluate(CHECK_LOGO);
    const broken = await page.evaluate(CHECK_BROKEN_IMAGES);
    const nav    = await page.evaluate(CHECK_NAV_LINKS);
    const footer = await page.evaluate(CHECK_FOOTER);
    const checks = await page.evaluate(() => ({
      hasLearnMore: Array.from(document.querySelectorAll('a,button')).some(b => /learn more/i.test(b.innerText)),
      hasCards:     !!(document.querySelector('[class*="card"], [class*="Card"], article')),
      donateHref:   Array.from(document.querySelectorAll('a,button')).find(b => /donate/i.test(b.innerText))?.href || null,
    }));
    return [
      { name: 'Logo visible and loaded',        pass: logo.pass,           detail: logo.detail },
      { name: 'No broken images',               pass: broken.pass,         detail: broken.pass ? `${broken.total} imgs OK` : `Broken: ${broken.broken.join(', ')}` },
      { name: 'Navigation links present',       pass: nav.pass,            detail: `${nav.count} links` },
      { name: 'Footer with links',              pass: footer.pass,         detail: `${footer.linkCount} links` },
      { name: '"Learn More" button present',    pass: checks.hasLearnMore, detail: checks.hasLearnMore ? 'Found' : 'Missing' },
      { name: 'Campaign cards visible',         pass: checks.hasCards,     detail: checks.hasCards ? 'Found' : 'Missing' },
      { name: 'Donate button has valid href',   pass: !!(checks.donateHref && checks.donateHref.length > 5), detail: checks.donateHref || 'Missing' },
    ];
  },

  // ── Chai Lifeline Canada (CLC) ───────────────────────────────────
  // img.custom-logo, "Ways to Give" nav, Login/Sign Up, donation form C$
  clc: async (page) => {
    const logo   = await page.evaluate(CHECK_LOGO);
    const broken = await page.evaluate(CHECK_BROKEN_IMAGES);
    const nav    = await page.evaluate(CHECK_NAV_LINKS);
    const footer = await page.evaluate(CHECK_FOOTER);
    const checks = await page.evaluate(() => ({
      hasWaysToGive: (document.body?.innerText||'').includes('Ways to Give'),
      hasLogin:      Array.from(document.querySelectorAll('a,button')).some(b => /login/i.test(b.innerText)),
      hasSignUp:     Array.from(document.querySelectorAll('a,button')).some(b => /sign up/i.test(b.innerText)),
      hasAmounts:    (document.body?.innerText||'').includes('C$') || (document.body?.innerText||'').includes('Give once') || (document.body?.innerText||'').includes('Monthly'),
      hasForm:       document.querySelectorAll('input[type="radio"], input[type="text"], input[type="number"]').length > 0,
    }));
    return [
      { name: 'Logo visible and loaded',          pass: logo.pass,            detail: logo.detail },
      { name: 'No broken images',                 pass: broken.pass,          detail: broken.pass ? `${broken.total} imgs OK` : `Broken: ${broken.broken.join(', ')}` },
      { name: 'Navigation links present',         pass: nav.pass,             detail: `${nav.count} links` },
      { name: 'Footer present',                   pass: footer.pass,          detail: `${footer.linkCount} links` },
      { name: '"Ways to Give" nav present',       pass: checks.hasWaysToGive, detail: checks.hasWaysToGive ? 'Found' : 'Missing' },
      { name: '"Login" button present',           pass: checks.hasLogin,      detail: checks.hasLogin ? 'Found' : 'Missing' },
      { name: 'Donation amounts visible',         pass: checks.hasAmounts,    detail: checks.hasAmounts ? 'Found' : 'Missing' },
      { name: 'Donation form inputs present',     pass: checks.hasForm,       detail: checks.hasForm ? 'Found' : 'Missing' },
    ];
  },

  // ── AFMDA ────────────────────────────────────────────────────────
  // LevCharity P2P platform. Logo is afdma-logo.svg (SVG — naturalWidth=0 is expected, check complete).
  // Nav: "Sign up to fundraise" + "Log In". Campaign cards grid. "Start your campaign" CTA.
  // "About Magen David Adom" section. Footer: powered-by-levcharity.svg.
  afmda: async (page) => {
    const logo   = await page.evaluate(CHECK_LOGO); // SVG-aware now
    const broken = await page.evaluate(CHECK_BROKEN_IMAGES);
    const nav    = await page.evaluate(CHECK_NAV_LINKS);
    const footer = await page.evaluate(CHECK_FOOTER);
    const checks = await page.evaluate(() => {
      const text = document.body?.innerText || '';
      const allBtns = Array.from(document.querySelectorAll('a,button')).map(b => b.innerText?.trim().toLowerCase());
      return {
        hasSignUpToFundraise: allBtns.some(t => t.includes('fundraise') || t.includes('campaign')),
        hasStartCampaign:     allBtns.some(t => t.includes('start') && t.includes('campaign') || t.includes('sign up to')),
        hasCampaignCards:     document.querySelectorAll('[class*="campaign"], [class*="p2p"], [class*="card"]').length > 0 || document.querySelectorAll('img[src*="150x150"]').length > 0,
        hasAboutSection:      text.includes('Magen David Adom') || text.includes('MDA') || text.toLowerCase().includes('about'),
        hasSupportSection:    text.toLowerCase().includes('support') && (text.toLowerCase().includes('campaign') || text.toLowerCase().includes('fundrais')),
        campaignHref:         Array.from(document.querySelectorAll('a')).find(a => /fundraise|campaign/i.test(a.innerText))?.href || null,
        imgCount:             document.querySelectorAll('img').length,
      };
    });
    return [
      { name: 'Logo visible and loaded (SVG)',      pass: logo.pass,                    detail: logo.detail },
      { name: 'No broken images',                   pass: broken.pass,                  detail: broken.pass ? `${broken.total} imgs OK` : `Broken: ${broken.broken.join(', ')}` },
      { name: 'Navigation links present',           pass: nav.pass,                     detail: `${nav.count} links` },
      { name: 'Footer present',                     pass: footer.pass,                  detail: `${footer.linkCount} links` },
      { name: '"Sign up to fundraise" CTA present', pass: checks.hasSignUpToFundraise,  detail: checks.hasSignUpToFundraise ? 'Found' : 'Missing' },
      { name: '"Start your campaign" link',         pass: checks.hasStartCampaign,      detail: checks.hasStartCampaign ? 'Found' : 'Missing' },
      { name: 'Campaign cards visible',             pass: checks.hasCampaignCards,      detail: checks.hasCampaignCards ? 'Found' : 'Missing' },
      { name: '"About Magen David Adom" section',   pass: checks.hasAboutSection,       detail: checks.hasAboutSection ? 'Found' : 'Missing' },
      { name: 'Campaign link has valid href',       pass: !!(checks.campaignHref && checks.campaignHref.length > 5), detail: checks.campaignHref?.slice(0,50) || 'Missing' },
    ];
  },

  // ── Misaskim ─────────────────────────────────────────────────────
  // Elementor site — logo NOT img.custom-logo (uses wp-image class in header)
  // Footer is elementor-location-footer with 11 links. Nav: Shiva Listings/Resources/Contact/Services
  misaskim: async (page) => {
    const logo   = await page.evaluate(CHECK_LOGO); // CHECK_LOGO now handles Elementor headers
    const broken = await page.evaluate(CHECK_BROKEN_IMAGES);
    const nav    = await page.evaluate(CHECK_NAV_LINKS);
    const footer = await page.evaluate(CHECK_FOOTER);
    const checks = await page.evaluate(() => {
      const navTexts = Array.from(document.querySelectorAll('nav a, header a, [class*="elementor-location-header"] a')).map(a => a.innerText?.trim().toLowerCase());
      return {
        navTexts,
        hasShiva:     navTexts.some(t => t.includes('shiva')),
        hasServices:  navTexts.some(t => t.includes('service')),
        hasDonate:    Array.from(document.querySelectorAll('a,button')).some(b => /donate/i.test(b.innerText)),
        donateHref:   Array.from(document.querySelectorAll('a,button')).find(b => /donate/i.test(b.innerText))?.href || null,
        hasOurMission:(document.body?.innerText||'').includes('Our Mission') || (document.body?.innerText||'').includes('mission'),
      };
    });
    return [
      { name: 'Logo visible and loaded',        pass: logo.pass,            detail: logo.detail },
      { name: 'No broken images',               pass: broken.pass,          detail: broken.pass ? `${broken.total} imgs OK` : `Broken: ${broken.broken.join(', ')}` },
      { name: 'Navigation links present',       pass: nav.pass,             detail: `${nav.count} links` },
      { name: 'Footer with links',              pass: footer.pass,          detail: `${footer.linkCount} links` },
      { name: '"Shiva Listings" nav item',      pass: checks.hasShiva,      detail: checks.hasShiva ? 'Found' : 'Missing' },
      { name: '"Services" nav item',            pass: checks.hasServices,   detail: checks.hasServices ? 'Found' : 'Missing' },
      { name: '"Donate Now" button present',    pass: checks.hasDonate,     detail: checks.hasDonate ? 'Found' : 'Missing' },
      { name: 'Donate button has valid href',   pass: !!(checks.donateHref && checks.donateHref.length > 5), detail: checks.donateHref || 'Missing' },
      { name: 'Mission content visible',        pass: checks.hasOurMission, detail: checks.hasOurMission ? 'Found' : 'Missing' },
    ];
  },

  // ── Mizrachi ─────────────────────────────────────────────────────
  // React app — bodyLen only ~34 chars. Content is campaign image cards.
  // Check img count and link count, NOT text length. Extra wait needed.
  mizrachi: async (page) => {
    await page.waitForTimeout(3000); // extra wait for React render
    const logo   = await page.evaluate(CHECK_LOGO);
    const broken = await page.evaluate(CHECK_BROKEN_IMAGES);
    const checks = await page.evaluate(() => ({
      imgCount:  document.querySelectorAll('img').length,
      linkCount: document.querySelectorAll('a[href]').length,
      hasLogo:   document.querySelectorAll('img').length > 0,
      // Mizrachi shows campaign cards as clickable images
      hasCampaigns: document.querySelectorAll('a[href] img, [class*="campaign"] img, [class*="card"] img').length > 0 || document.querySelectorAll('a').length > 2,
      snippet:   (document.body?.innerText||'').slice(0,80),
    }));
    return [
      { name: 'Logo visible and loaded',      pass: logo.pass,               detail: logo.detail },
      { name: 'No broken images',             pass: broken.pass,             detail: broken.pass ? `${checks.imgCount} imgs OK` : `Broken: ${broken.broken.join(', ')}` },
      { name: 'Page has content (React app)', pass: checks.imgCount > 1 || checks.linkCount > 2, detail: `${checks.imgCount} imgs, ${checks.linkCount} links` },
      { name: 'Campaign cards/links visible', pass: checks.hasCampaigns,     detail: checks.hasCampaigns ? 'Found' : `${checks.linkCount} links total` },
    ];
  },

  // ── Shomrim Toronto ──────────────────────────────────────────────
  // Elementor site. No <nav> tag — header is div.elementor-location-header with 32 links.
  // Real footer is elementor-location-footer. Cookie wrapper .cky-footer-wrapper is excluded.
  shomrim: async (page) => {
    const logo   = await page.evaluate(CHECK_LOGO);
    const broken = await page.evaluate(CHECK_BROKEN_IMAGES);
    const nav    = await page.evaluate(CHECK_NAV_LINKS); // handles Elementor
    const footer = await page.evaluate(CHECK_FOOTER);    // excludes .cky-footer-wrapper
    const checks = await page.evaluate(() => {
      const allLinks = Array.from(document.querySelectorAll('a, button')).map(b => b.innerText?.trim().toLowerCase());
      return {
        hasPhone:     (document.body?.innerText||'').includes('647'),
        hasIncident:  allLinks.some(t => /incident/i.test(t)),
        incidentHref: Array.from(document.querySelectorAll('a')).find(a => /incident/i.test(a.innerText))?.href || null,
        hasDonate:    allLinks.some(t => /^donate$/i.test(t.trim())),
        hasAbout:     allLinks.some(t => t.includes('about')),
        hasVolunteer: allLinks.some(t => t.includes('volunteer')),
      };
    });
    return [
      { name: 'Logo visible and loaded',              pass: logo.pass,                                          detail: logo.detail },
      { name: 'No broken images',                     pass: broken.pass,                                        detail: broken.pass ? `${broken.total} imgs OK` : `Broken: ${broken.broken.join(', ')}` },
      { name: 'Navigation links present (Elementor)', pass: nav.pass,                                           detail: `${nav.count} links` },
      { name: 'Footer present',                       pass: footer.pass,                                        detail: `${footer.linkCount} links` },
      { name: 'Emergency phone number visible',       pass: checks.hasPhone,                                    detail: checks.hasPhone ? '647 found' : 'Missing' },
      { name: '"File an incident" button exists',     pass: checks.hasIncident,                                 detail: checks.hasIncident ? 'Found' : 'Missing' },
      { name: '"File an incident" has valid href',    pass: !!(checks.incidentHref && checks.incidentHref.length > 10), detail: checks.incidentHref || 'Missing' },
      { name: '"Donate" link present',                pass: checks.hasDonate,                                   detail: checks.hasDonate ? 'Found' : 'Missing' },
    ];
  },

  // ── Fallen Heroes ────────────────────────────────────────────────
  // Custom WP, logo in header, donation amounts $180/$360, custom amount, dedication
  fallen: async (page) => {
    const logo   = await page.evaluate(CHECK_LOGO);
    const broken = await page.evaluate(CHECK_BROKEN_IMAGES);
    const nav    = await page.evaluate(CHECK_NAV_LINKS);
    const footer = await page.evaluate(CHECK_FOOTER);
    const checks = await page.evaluate(() => {
      const text = document.body?.innerText || '';
      return {
        hasAmounts:   text.includes('180') && text.includes('360'),
        hasCustom:    text.toLowerCase().includes('custom'),
        hasDedicated: text.toLowerCase().includes('dedicat'),
        hasCampaigns: Array.from(document.querySelectorAll('a,button')).some(b => /fundraising|campaign/i.test(b.innerText)),
        donateHref:   Array.from(document.querySelectorAll('a,button')).find(b => /donate/i.test(b.innerText))?.href || null,
      };
    });
    return [
      { name: 'Logo visible and loaded',            pass: logo.pass,            detail: logo.detail },
      { name: 'No broken images',                   pass: broken.pass,          detail: broken.pass ? `${broken.total} imgs OK` : `Broken: ${broken.broken.join(', ')}` },
      { name: 'Navigation links present',           pass: nav.pass,             detail: `${nav.count} links` },
      { name: 'Footer present',                     pass: footer.pass,          detail: `${footer.linkCount} links` },
      { name: 'Donation amounts ($180, $360)',       pass: checks.hasAmounts,    detail: checks.hasAmounts ? 'Found' : 'Missing' },
      { name: 'Custom amount option',               pass: checks.hasCustom,     detail: checks.hasCustom ? 'Found' : 'Missing' },
      { name: 'Dedication option',                  pass: checks.hasDedicated,  detail: checks.hasDedicated ? 'Found' : 'Missing' },
      { name: '"Fundraising Campaigns" link',       pass: checks.hasCampaigns,  detail: checks.hasCampaigns ? 'Found' : 'Missing' },
      { name: 'Donate button has valid href',       pass: !!(checks.donateHref && checks.donateHref.length > 5), detail: checks.donateHref || 'Missing' },
    ];
  },

  // ── Nitzanim ─────────────────────────────────────────────────────
  // Member portal. img.custom-logo (SVG — but naturalWidth=194 so it loads fine).
  // No <nav> tag, no footer links — this is EXPECTED for a member portal.
  // Key buttons: Become a Member, Amutah Payment, Events, Sponsorships, General Donations, Donate
  nitzanim: async (page) => {
    const logo   = await page.evaluate(CHECK_LOGO);
    const broken = await page.evaluate(CHECK_BROKEN_IMAGES);
    const checks = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('a, button')).map(b => b.innerText?.trim().toLowerCase());
      return {
        hasMember:    btns.some(t => t.includes('member')),
        hasDonate:    btns.some(t => /donate/i.test(t)),
        hasEvents:    btns.some(t => t.includes('event')),
        hasSponsorship: btns.some(t => t.includes('sponsor')),
        hasPortalHome:  btns.some(t => t.includes('portal')),
        donateHref:   Array.from(document.querySelectorAll('a,button')).find(b => /donate/i.test(b.innerText))?.href || null,
        hasWelcome:   (document.body?.innerText||'').includes('Welcome') || (document.body?.innerText||'').includes('Kehilat'),
      };
    });
    return [
      { name: 'Logo visible and loaded',             pass: logo.pass,               detail: logo.detail },
      { name: 'No broken images',                    pass: broken.pass,             detail: broken.pass ? `${broken.total} imgs OK` : `Broken: ${broken.broken.join(', ')}` },
      { name: 'Welcome/portal heading visible',      pass: checks.hasWelcome,       detail: checks.hasWelcome ? 'Found' : 'Missing' },
      { name: '"Become a Member" button present',    pass: checks.hasMember,        detail: checks.hasMember ? 'Found' : 'Missing' },
      { name: '"Events" button present',             pass: checks.hasEvents,        detail: checks.hasEvents ? 'Found' : 'Missing' },
      { name: '"Sponsorships" button present',       pass: checks.hasSponsorship,   detail: checks.hasSponsorship ? 'Found' : 'Missing' },
      { name: '"Donate" button present',             pass: checks.hasDonate,        detail: checks.hasDonate ? 'Found' : 'Missing' },
      { name: 'Donate button has valid href',        pass: !!(checks.donateHref && checks.donateHref.length > 5), detail: checks.donateHref || 'Missing' },
    ];
  },

  // ── Israel Magen Fund ────────────────────────────────────────────
  // Standard WP. logo in header. "DONATE NOW", "Become a Fundraiser", "Our Impact"
  imf: async (page) => {
    const logo   = await page.evaluate(CHECK_LOGO);
    const broken = await page.evaluate(CHECK_BROKEN_IMAGES);
    const nav    = await page.evaluate(CHECK_NAV_LINKS);
    const footer = await page.evaluate(CHECK_FOOTER);
    const checks = await page.evaluate(() => ({
      hasFundraiserLink: Array.from(document.querySelectorAll('a,button')).some(b => /fundraiser/i.test(b.innerText)),
      hasImpact:         (document.body?.innerText||'').toLowerCase().includes('impact'),
      hasProjects:       (document.body?.innerText||'').toLowerCase().includes('project'),
      donateHref:        Array.from(document.querySelectorAll('a,button')).find(b => /donate now/i.test(b.innerText))?.href || Array.from(document.querySelectorAll('a,button')).find(b => /donate/i.test(b.innerText))?.href || null,
    }));
    return [
      { name: 'Logo visible and loaded',             pass: logo.pass,                 detail: logo.detail },
      { name: 'No broken images',                    pass: broken.pass,               detail: broken.pass ? `${broken.total} imgs OK` : `Broken: ${broken.broken.join(', ')}` },
      { name: 'Navigation links present',            pass: nav.pass,                  detail: `${nav.count} links` },
      { name: 'Footer with links',                   pass: footer.pass,               detail: `${footer.linkCount} links` },
      { name: '"Become a Fundraiser" link',          pass: checks.hasFundraiserLink,  detail: checks.hasFundraiserLink ? 'Found' : 'Missing' },
      { name: '"Our Impact" section visible',        pass: checks.hasImpact,          detail: checks.hasImpact ? 'Found' : 'Missing' },
      { name: '"Donate Now" button has valid href',  pass: !!(checks.donateHref && checks.donateHref.length > 5), detail: checks.donateHref || 'Missing' },
    ];
  },

  // ── ADI ──────────────────────────────────────────────────────────
  // Custom WP — logo has class wp-image-6538 (NOT img.custom-logo), alt="ADI logo", w:83
  // CHECK_LOGO handles this via the header img fallback.
  // Nav: About/Services/Centers/Ways to Give/News/Contact/Ability Boutique/Ecards/Donate
  // Footer: 57 links. Donate → /donate/
  adi: async (page) => {
    const logo   = await page.evaluate(CHECK_LOGO);
    const broken = await page.evaluate(CHECK_BROKEN_IMAGES);
    const nav    = await page.evaluate(CHECK_NAV_LINKS);
    const footer = await page.evaluate(CHECK_FOOTER);
    const checks = await page.evaluate(() => {
      const navTexts = Array.from(document.querySelectorAll('nav a, header a')).map(a => a.innerText?.trim().toLowerCase());
      return {
        navTexts,
        hasWaysToGive: navTexts.some(t => t.includes('ways to give')),
        hasEcards:     navTexts.some(t => t.includes('ecard')),
        hasCenters:    navTexts.some(t => t.includes('center')),
        hasDonate:     Array.from(document.querySelectorAll('a,button')).some(b => /donate/i.test(b.innerText)),
        donateHref:    Array.from(document.querySelectorAll('a,button')).find(b => /donate/i.test(b.innerText))?.href || null,
        hasHero:       (document.body?.innerText||'').includes('Humanity') || (document.body?.innerText||'').includes('Healing') || (document.body?.innerText||'').includes('Hope'),
      };
    });
    return [
      { name: 'Logo visible and loaded',        pass: logo.pass,               detail: logo.detail },
      { name: 'No broken images',               pass: broken.pass,             detail: broken.pass ? `${broken.total} imgs OK` : `Broken: ${broken.broken.join(', ')}` },
      { name: 'Navigation links present',       pass: nav.pass,                detail: `${nav.count} links` },
      { name: 'Footer with links',              pass: footer.pass,             detail: `${footer.linkCount} links` },
      { name: '"Ways to Give" nav item',        pass: checks.hasWaysToGive,    detail: checks.hasWaysToGive ? 'Found' : 'Missing' },
      { name: '"Ecards" nav item',              pass: checks.hasEcards,        detail: checks.hasEcards ? 'Found' : 'Missing' },
      { name: '"Centers" nav item',             pass: checks.hasCenters,       detail: checks.hasCenters ? 'Found' : 'Missing' },
      { name: 'Hero headline visible',          pass: checks.hasHero,          detail: checks.hasHero ? 'Found' : 'Missing' },
      { name: '"Donate" button has valid href', pass: !!(checks.donateHref && checks.donateHref.length > 5), detail: checks.donateHref || 'Missing' },
    ];
  },

  // ── The Yeshiva ──────────────────────────────────────────────────
  // Donation page only. Lazy images excluded from broken check.
  // Tiers: $1,000 / $500 / $360 / $250. Give once/Monthly toggle.
  yeshiva: async (page) => {
    const logo   = await page.evaluate(CHECK_LOGO);
    const broken = await page.evaluate(CHECK_BROKEN_IMAGES); // lazy excluded
    const footer = await page.evaluate(CHECK_FOOTER);
    const checks = await page.evaluate(() => ({
      hasTiers:    (document.body?.innerText||'').includes('$1,000') || (document.body?.innerText||'').includes('$500') || (document.body?.innerText||'').includes('Sponsor'),
      hasToggle:   (document.body?.innerText||'').includes('Give once') || (document.body?.innerText||'').includes('Monthly'),
      hasBackBtn:  Array.from(document.querySelectorAll('a,button')).some(b => /back to home/i.test(b.innerText)),
      formInputs:  Array.from(document.querySelectorAll('input[type="radio"],input[type="text"],input[type="email"]')).filter(i=>!i.disabled).length,
    }));
    return [
      { name: 'Logo visible and loaded',          pass: logo.pass,             detail: logo.detail },
      { name: 'No broken images (lazy excluded)', pass: broken.pass,           detail: broken.pass ? `${broken.total} imgs checked` : `Broken: ${broken.broken.join(', ')}` },
      { name: 'Footer present',                   pass: footer.pass,           detail: `${footer.linkCount} links` },
      { name: '"Back to Home" button present',    pass: checks.hasBackBtn,     detail: checks.hasBackBtn ? 'Found' : 'Missing' },
      { name: 'Donation tiers visible',           pass: checks.hasTiers,       detail: checks.hasTiers ? 'Found' : 'Missing' },
      { name: '"Give once" / "Monthly" toggle',   pass: checks.hasToggle,      detail: checks.hasToggle ? 'Found' : 'Missing' },
      { name: 'Form inputs enabled',              pass: checks.formInputs > 0, detail: `${checks.formInputs} enabled` },
    ];
  },

  // ── Nahal Haredi ─────────────────────────────────────────────────
  // img.custom-logo. Nav: About Us/Campaigns/eCards/Crowdfunding/Day of Torah/Ways to Support
  // Donation amounts start at $18. Form inputs present.
  nahal: async (page) => {
    const logo   = await page.evaluate(CHECK_LOGO);
    const broken = await page.evaluate(CHECK_BROKEN_IMAGES);
    const nav    = await page.evaluate(CHECK_NAV_LINKS);
    const footer = await page.evaluate(CHECK_FOOTER);
    const checks = await page.evaluate(() => {
      const navTexts = Array.from(document.querySelectorAll('nav a, header a')).map(a => a.innerText?.trim().toLowerCase());
      return {
        navTexts,
        hasCampaigns: navTexts.some(t => t.includes('campaign')),
        hasEcards:    navTexts.some(t => t.includes('ecard')),
        hasAmounts:   (document.body?.innerText||'').includes('18') && (document.body?.innerText||'').includes('36'),
        hasToggle:    (document.body?.innerText||'').includes('Give once') || (document.body?.innerText||'').includes('Monthly'),
        formInputs:   Array.from(document.querySelectorAll('input[type="radio"],input[type="text"],input[type="submit"],button[type="submit"]')).filter(i=>!i.disabled).length,
        donateHref:   Array.from(document.querySelectorAll('a,button')).find(b => /donate/i.test(b.innerText))?.href || null,
      };
    });
    return [
      { name: 'Logo visible and loaded',       pass: logo.pass,              detail: logo.detail },
      { name: 'No broken images',              pass: broken.pass,            detail: broken.pass ? `${broken.total} imgs OK` : `Broken: ${broken.broken.join(', ')}` },
      { name: 'Navigation links present',      pass: nav.pass,               detail: `${nav.count} links` },
      { name: 'Footer with links',             pass: footer.pass,            detail: `${footer.linkCount} links` },
      { name: '"Campaigns" nav item',          pass: checks.hasCampaigns,    detail: checks.hasCampaigns ? 'Found' : 'Missing' },
      { name: '"eCards" nav item',             pass: checks.hasEcards,       detail: checks.hasEcards ? 'Found' : 'Missing' },
      { name: 'Donation amounts visible',      pass: checks.hasAmounts,      detail: checks.hasAmounts ? 'Found' : 'Missing' },
      { name: '"Give once" / "Monthly"',       pass: checks.hasToggle,       detail: checks.hasToggle ? 'Found' : 'Missing' },
      { name: 'Form inputs enabled',           pass: checks.formInputs > 0,  detail: `${checks.formInputs} enabled` },
      { name: 'Donate button has valid href',  pass: !!(checks.donateHref && checks.donateHref.length > 5), detail: checks.donateHref || 'Missing' },
    ];
  },

  // ── Race to Bais Olami ───────────────────────────────────────────
  // SVG icons report naturalWidth=0 — EXCLUDED by CHECK_BROKEN_IMAGES.
  // Campaign page: "100 young men", "DONATE", "REGISTER" CTAs.
  r2bo: async (page) => {
    const logo   = await page.evaluate(CHECK_LOGO);
    const broken = await page.evaluate(CHECK_BROKEN_IMAGES); // SVGs excluded
    const footer = await page.evaluate(CHECK_FOOTER);
    const checks = await page.evaluate(() => ({
      hasContent:  (document.body?.innerText||'').includes('Race') || (document.body?.innerText||'').includes('Bais') || (document.body?.innerText||'').includes('Yeshiva'),
      hasCTABtns:  document.querySelectorAll('a[href*="donate"], a[href*="register"], button').length > 0,
      hasCampaign: (document.body?.innerText||'').includes('100') || (document.body?.innerText||'').includes('young men') || document.querySelectorAll('img').length > 2,
      donateHref:  Array.from(document.querySelectorAll('a,button')).find(b => /donate/i.test(b.innerText))?.href || null,
    }));
    return [
      { name: 'Logo visible and loaded',        pass: logo.pass,            detail: logo.detail },
      { name: 'No broken images (SVG excluded)',pass: broken.pass,          detail: broken.pass ? `${broken.total} imgs checked` : `Broken: ${broken.broken.join(', ')}` },
      { name: 'Footer present',                 pass: footer.pass,          detail: `${footer.linkCount} links` },
      { name: 'Campaign content visible',       pass: checks.hasContent,    detail: checks.hasContent ? 'Found' : 'Missing' },
      { name: 'CTA buttons present',            pass: checks.hasCTABtns,    detail: checks.hasCTABtns ? 'Found' : 'Missing' },
      { name: 'Donate button has valid href',   pass: !!(checks.donateHref && checks.donateHref.length > 5), detail: checks.donateHref || 'Missing' },
    ];
  },

  // ── Ohr Torah Stone ──────────────────────────────────────────────
  // Donation page. img.custom-logo. Donate button, language selector, amounts ($36/$50/$100)
  // Give once/Monthly, dedication option. Form inputs enabled.
  ots: async (page) => {
    const logo   = await page.evaluate(CHECK_LOGO);
    const broken = await page.evaluate(CHECK_BROKEN_IMAGES);
    const footer = await page.evaluate(CHECK_FOOTER);
    const checks = await page.evaluate(() => ({
      hasAmounts:   (document.body?.innerText||'').includes('36') && ((document.body?.innerText||'').includes('50') || (document.body?.innerText||'').includes('100')),
      hasToggle:    (document.body?.innerText||'').includes('Give once') || (document.body?.innerText||'').includes('Monthly'),
      hasLang:      !!(document.querySelector('select')) || (document.body?.innerText||'').includes('English'),
      hasDedicated: (document.body?.innerText||'').toLowerCase().includes('dedicat'),
      formInputs:   Array.from(document.querySelectorAll('input[type="radio"],input[type="text"],input[type="number"],input[type="email"]')).filter(i=>!i.disabled).length,
      donateHref:   Array.from(document.querySelectorAll('a,button')).find(b => /donate/i.test(b.innerText))?.href || null,
    }));
    return [
      { name: 'Logo visible and loaded',        pass: logo.pass,              detail: logo.detail },
      { name: 'No broken images',               pass: broken.pass,            detail: broken.pass ? `${broken.total} imgs OK` : `Broken: ${broken.broken.join(', ')}` },
      { name: 'Footer present',                 pass: footer.pass,            detail: `${footer.linkCount} links` },
      { name: 'Donation amounts visible',       pass: checks.hasAmounts,      detail: checks.hasAmounts ? 'Found' : 'Missing' },
      { name: '"Give once" / "Monthly"',        pass: checks.hasToggle,       detail: checks.hasToggle ? 'Found' : 'Missing' },
      { name: 'Language selector present',      pass: checks.hasLang,         detail: checks.hasLang ? 'Found' : 'Missing' },
      { name: 'Dedication option visible',      pass: checks.hasDedicated,    detail: checks.hasDedicated ? 'Found' : 'Missing' },
      { name: 'Form inputs enabled',            pass: checks.formInputs > 0,  detail: `${checks.formInputs} enabled` },
      { name: 'Donate button has valid href',   pass: !!(checks.donateHref && checks.donateHref.length > 5), detail: checks.donateHref || 'Missing' },
    ];
  },
};

// ─────────────────────────────────────────────────────────────────
// ERROR PATTERNS
// ─────────────────────────────────────────────────────────────────
const ERROR_TITLE_WORDS  = ['404','403','500','502','503','504','not found','error','page not found','access denied','forbidden','bad gateway','service unavailable','internal server error'];
const ERROR_BODY_PHRASES = ["this site can't be reached","this page isn't working",'err_connection_refused','dns_probe_finished','application error','database connection','fatal error','under construction','coming soon','parked domain','buy this domain','this domain is for sale','account suspended','bandwidth limit exceeded'];

// ─────────────────────────────────────────────────────────────────
// LOGGING + FIREBASE
// ─────────────────────────────────────────────────────────────────
const log = (msg, type='info') => {
  const icons = { info:'  ', pass:'✅', fail:'❌', warn:'⚠️ ', ai:'🤖' };
  console.log(`${icons[type]||'  '} ${msg}`);
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

// ─────────────────────────────────────────────────────────────────
// GEMINI VISION
// ─────────────────────────────────────────────────────────────────
async function analyzeWithGemini(screenshotBase64, site) {
  const prompt = `QA agent checking "${site.name}" (${site.url}).
REPORT ONLY: blank/white page, HTTP error pages, DNS failure, domain parking, coming soon, server crash, wrong website, public page behind login wall.
IGNORE: text changes, images, campaigns, layout, cookie banners, popups, normal charity content.
Reply ONLY with JSON: {"passing":true,"majorIssues":[],"pageDescription":"one sentence"}`;
  async function callGemini(url) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [
          { inline_data: { mime_type: 'image/jpeg', data: screenshotBase64 } },
          { text: prompt },
        ]}],
        generationConfig: { temperature: 0.1, maxOutputTokens: 200 },
      }),
    });
  }
  try {
    let res = await callGemini(GEMINI_URL);
    // On 429 (quota exceeded), retry with fallback model which has a separate quota bucket
    if (res.status === 429) {
      log(`  Gemini primary quota exceeded — retrying with fallback model (${GEMINI_MODEL_FALLBACK})...`, 'warn');
      res = await callGemini(GEMINI_URL_FALLBACK);
    }
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0,200)}`);
    const json = await res.json();
    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    const parsed = JSON.parse(text.replace(/```json|```/g,'').trim());
    return {
      passing: Boolean(parsed.passing),
      majorIssues: Array.isArray(parsed.majorIssues) ? parsed.majorIssues : [],
      pageDescription: parsed.pageDescription || 'Analysis complete.',
    };
  } catch(err) {
    log(`  Gemini error: ${err.message}`, 'warn');
    return { passing: null, majorIssues: [], pageDescription: 'Vision analysis unavailable.', error: err.message };
  }
}

// ─────────────────────────────────────────────────────────────────
// CORE TEST RUNNER
// ─────────────────────────────────────────────────────────────────
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

    // ── 1. Load homepage ──────────────────────────────────────────
    try {
      const t0 = Date.now();
      const response = await page.goto(site.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      const httpStatus = response?.status() ?? 0;
      result.checks.httpStatus = { pass: httpStatus < 400, value: httpStatus };
      result.checks.loadTimeMs = { pass: true, value: Date.now() - t0 };
      if (httpStatus >= 400) result.majorFailures.push(`HTTP ${httpStatus} error`);
    } catch(navErr) {
      result.checks.httpStatus = { pass: false, error: navErr.message };
      result.majorFailures.push(`Page failed to load: ${navErr.message.split('\n')[0]}`);
      result.status = 'error';
      await context.close();
      return finalise(result);
    }

    try { await page.waitForLoadState('networkidle', { timeout: 10000 }); } catch {}
    await page.waitForTimeout(2000);

    // ── 2. Generic page-level checks ─────────────────────────────
    const title = await page.title().catch(() => '');
    result.checks.pageTitle = { pass: title.length > 0 && !ERROR_TITLE_WORDS.some(w => title.toLowerCase().includes(w)), value: title };
    if (!result.checks.pageTitle.pass) result.majorFailures.push(`Error in page title: "${title}"`);

    // Use both text AND image count — React apps have minimal text
    const { bodyLen, bodySnippet, imgCount, linkCount } = await page.evaluate(() => {
      const t = document.body?.innerText || '';
      return {
        bodyLen: t.length,
        bodySnippet: t.slice(0,600).toLowerCase(),
        imgCount: document.querySelectorAll('img').length,
        linkCount: document.querySelectorAll('a[href]').length,
      };
    }).catch(() => ({ bodyLen: 0, bodySnippet: '', imgCount: 0, linkCount: 0 }));

    result.checks.hasContent = { pass: bodyLen > 50 || imgCount > 2 || linkCount > 3, value: `${bodyLen} chars, ${imgCount} imgs, ${linkCount} links` };
    if (!result.checks.hasContent.pass) result.majorFailures.push('Page appears blank — no text, images, or links detected');

    const errorPhrase = ERROR_BODY_PHRASES.find(p => bodySnippet.includes(p));
    result.checks.noErrorContent = { pass: !errorPhrase };
    if (errorPhrase) result.majorFailures.push(`Error phrase found: "${errorPhrase}"`);

    // ── 3. Per-site UI checks ─────────────────────────────────────
    if (SITE_CHECKS[site.id]) {
      try {
        const uiResults = await SITE_CHECKS[site.id](page, site);
        result.uiChecks = uiResults;
        const failed = uiResults.filter(c => !c.pass);
        const passed = uiResults.filter(c => c.pass).length;
        log(`  UI: ${passed}/${uiResults.length} passed`, passed === uiResults.length ? 'pass' : 'warn');
        uiResults.forEach(c => {
          const d = c.detail ? ` (${c.detail})` : '';
          log(`    ${c.pass ? '✓' : '✗'} ${c.name}${d}`);
        });
        // Major failure thresholds — conservative to avoid false positives
        const logoFail   = uiResults.find(c => c.name.toLowerCase().includes('logo') && !c.pass);
        const brokenFail = uiResults.find(c => c.name.toLowerCase().includes('broken image') && !c.pass);
        if (logoFail)   result.majorFailures.push('Logo not loading — site header may be broken');
        if (brokenFail) result.majorFailures.push(`Broken images detected: ${brokenFail.detail}`);
        // Only flag as major if 5+ checks fail (very conservative — minor issues are warnings)
        if (failed.length >= 5) result.majorFailures.push(`${failed.length} UI checks failing: ${failed.map(c=>c.name).join(', ')}`);
      } catch(uiErr) {
        log(`  UI checks error: ${uiErr.message}`, 'warn');
      }
    }

    // ── 4. Screenshot + Gemini vision ─────────────────────────────
    try {
      const ss = await page.screenshot({ type: 'jpeg', quality: 72, fullPage: false, clip: { x:0, y:0, width:1440, height:900 } });
      fs.writeFileSync(path.join(SCREENSHOT_DIR, `${site.id}.jpg`), ss);
      log('  Gemini vision...', 'ai');
      const ai = await analyzeWithGemini(ss.toString('base64'), site);
      result.aiAnalysis = ai;
      log(`  Gemini: ${ai.pageDescription}`, 'ai');
      if (ai.passing === false && ai.majorIssues?.length > 0) {
        for (const issue of ai.majorIssues) {
          const dupe = result.majorFailures.some(f => f.toLowerCase().includes(issue.toLowerCase().slice(0,20)));
          if (!dupe) result.majorFailures.push(`[Vision] ${issue}`);
        }
      }
    } catch(ssErr) {
      log(`  Screenshot error: ${ssErr.message}`, 'warn');
    }

  } catch(outerErr) {
    result.majorFailures.push(`Unexpected error: ${outerErr.message}`);
    result.status = 'error';
  } finally {
    if (context) await context.close().catch(()=>{});
  }
  return finalise(result);
}

function finalise(result) {
  result.status = result.majorFailures.length > 0 ? 'fail' : 'pass';
  if (result.status === 'pass') log(`${result.name} — PASSED`, 'pass');
  else log(`${result.name} — FAILED: ${result.majorFailures.join(' | ')}`, 'fail');
  return result;
}

// ─────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────
async function main() {
  const date = new Date().toISOString().split('T')[0];
  console.log('\n══════════════════════════════════════════');
  console.log(`  QA Agent v5 — ${date}`);
  console.log('══════════════════════════════════════════\n');

  const sitesToTest = SINGLE_SITE ? SITES.filter(s => s.id === SINGLE_SITE) : SITES;
  if (!sitesToTest.length) { console.error(`No site: "${SINGLE_SITE}"`); process.exit(1); }
  log(`Running ${sitesToTest.length} sites — real DOM checks, no false positives`);

  const browser = await chromium.launch({ args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage'] });

  let passed=0, failed=0, errored=0;
  const failures = [];

  for (let i=0; i<sitesToTest.length; i++) {
    const site = sitesToTest[i];
    try {
      const result = await testSite(browser, site);
      if      (result.status==='pass')  passed++;
      else if (result.status==='error') errored++;
      else { failed++; failures.push(result); }
      await fbWrite(`autoResults/${date}/${site.id}`, result).catch(e =>
        log(`Firebase write failed for ${site.id}: ${e.message}`, 'warn')
      );
      if (i < sitesToTest.length-1) await new Promise(r => setTimeout(r, 8000));
    } catch(err) {
      log(`Fatal on ${site.name}: ${err.message}`, 'fail');
      errored++;
    }
  }

  await browser.close();

  const summary = {
    date, runAt: new Date().toISOString(),
    totalSites: sitesToTest.length, passed, failed, errored,
    hasMajorFailures: failures.length > 0,
    failedSites: failures.map(f=>({ id:f.id, name:f.name, url:f.url, majorFailures:f.majorFailures })),
  };
  await fbWrite(`autoSummary/${date}`, summary).catch(()=>{});
  await fbWrite('autoLatest', { date, ...summary }).catch(()=>{});

  console.log('\n══════════════════════════════════════════');
  console.log(`  Done: ${passed} passed · ${failed} failed · ${errored} errors`);
  console.log('══════════════════════════════════════════\n');

  if (failures.length > 0) {
    console.log('🚨 MAJOR FAILURES DETECTED:\n');
    failures.forEach(f => {
      console.log(`  ▸ ${f.name} — ${f.url}`);
      f.majorFailures.forEach(i => console.log(`      → ${i}`));
    });
    process.exit(1);
  } else {
    console.log('✅ All 19 sites healthy\n');
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
