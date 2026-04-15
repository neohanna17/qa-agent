/**
 * LevCharity Flow Test — Full Site UI Validation
 * Based on Ghost Inspector test suite + live DOM inspection of all 19 sites
 *
 * Each site is classified by type and tested with the appropriate module suite.
 * No false failures — checks are only run on modules that actually exist on each site.
 *
 * Site Types:
 *   teamCampaign  — Full team campaign (fundraiser list, hero, donations/about, search, pagination)
 *   p2pCampaign   — Individual P2P campaign page (hero, progress bar, donate button, social share)
 *   donationForm  — Pure donation form (amounts, donate button, checkout flow)
 *   portal        — Portal/hub (multiple pages: donate, events, membership)
 *
 * Run all:          FIREBASE_DATABASE_URL=xxx node scripts/flow-test.js
 * Run one site:     SINGLE_SITE=pantry node scripts/flow-test.js
 * Run by type:      SITE_TYPE=donationForm node scripts/flow-test.js
 */

'use strict';
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
chromium.use(stealth());
const fs   = require('fs');
const path = require('path');

const FIREBASE_URL   = (process.env.FIREBASE_DATABASE_URL || '').replace(/\/$/, '');
const SINGLE_SITE    = process.env.SINGLE_SITE || '';
const SITE_TYPE      = process.env.SITE_TYPE || '';
const SCREENSHOT_DIR = '/tmp/flow-screenshots';
if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
if (!FIREBASE_URL) { console.error('FIREBASE_DATABASE_URL not set'); process.exit(1); }

// ─────────────────────────────────────────────────────────────────────────────
// SITE REGISTRY
// Each site specifies: id, name, url, type, and type-specific config
// ─────────────────────────────────────────────────────────────────────────────
const SITES = [
  {
    id: 'pantry', name: 'Pantry Packers', url: 'https://give.pantrypackers.org',
    type: 'teamCampaign',
    config: {
      campaignPath:   '/bar-mitzvah/',
      participatePath:'/bar-mitzvah/participate/',
      addToCartUrl:   'https://give.pantrypackers.org/?lc-add-to-cart=16',
      searchSelector: 'input[name="participants-list-search"]',
      hasDonationsAbout: true,
      hasAmbassadors:    true,
      hasSocialShare:    false,
    }
  },
  {
    id: 'israelthon', name: 'Israelthon', url: 'https://israelthon.org',
    type: 'teamCampaign',
    config: {
      campaignPath:   '/',
      fundraiserListPath: '/raisers/',
      participatePath:'/israelthon/participate/',
      addToCartUrl:   'https://israelthon.org/?lc-add-to-cart=68',
      searchSelector: 'input[name="participants-list-search"]',
      hasDonationsAbout: false,
      hasAmbassadors:    false,
      hasSocialShare:    false,
    }
  },
  {
    id: 'chaiathon', name: 'Chaiathon', url: 'https://chaiathon.org',
    type: 'teamCampaign',
    config: {
      campaignPath:      '/chaiathon/yavneh-academy/',
      fundraiserListPath:'/fundraisers/',
      participatePath:   '/chaiathon/yavneh-academy/participate/',
      addToCartUrl:      'https://chaiathon.org/?lc-add-to-cart=664',
      searchSelector:    'input[name="participants-list-search"]',
      paginationSelector:'.levcharity-pagination',
      hasDonationsAbout: false,
      hasAmbassadors:    false,
      hasSocialShare:    true,
      extraTests:        ['searchPagination'],  // Chaiathon-specific pagination bug test
    }
  },
  {
    id: 'fcl', name: 'Chai Lifeline USA', url: 'https://fundraise.chailifeline.org',
    type: 'teamCampaign',
    config: {
      campaignPath:   '/hikingbyachad/',
      participatePath:'/hikingbyachad/participate/',
      addToCartUrl:   'https://fundraise.chailifeline.org/?lc-add-to-cart=17890',
      searchSelector: 'input[name="participants-list-search"]',
      hasDonationsAbout: false,
      hasAmbassadors:    false,
      hasSocialShare:    false,
    }
  },
  {
    id: 'r2bo', name: 'Race to Bais Olami', url: 'https://racetobais.olami.org',
    type: 'teamCampaign',
    config: {
      campaignPath:   '/r2b',
      participatePath:'/participate/',
      searchSelector: 'input[name="participants-list-search"]',
      hasDonationsAbout: true,
      hasAmbassadors:    true,
      hasSocialShare:    false,
    }
  },
  {
    id: 'uh', name: 'United Hatzalah', url: 'https://israelrescue.org',
    type: 'teamCampaign',
    config: {
      campaignPath:    '/my-mitzvah-all-campaigns/',
      participatePath: '/participate/',
      cloudflareBlocked: true,   // CI IPs blocked by CF — skip interactive checks
      hasDonationsAbout: false,
      hasAmbassadors:    false,
      hasSocialShare:    false,
    }
  },
  // ── P2P Individual Campaign sites ─────────────────────────────────────────
  {
    id: 'afmda', name: 'AFMDA', url: 'https://crowdfund.afmda.org',
    type: 'p2pCampaign',
    config: {
      listPath:       '/',                                    // Homepage shows campaign cards
      campaignPath:   '/p2p-campaign/help-mda-save-lives/',  // Representative campaign
      signupPath:     '/p2p-create-campaign/',
      addToCartId:    '12220',
      hasProgressBar: true,
      hasSocialShare: true,
    }
  },
  {
    id: 'nahal', name: 'Nahal Haredi', url: 'https://give.nahalharedi.org',
    type: 'p2pCampaign',
    config: {
      listPath:       '/campaigns/',
      campaignPath:   '/campaign/purim/',
      addToCartUrl:   'https://give.nahalharedi.org/?lc-add-to-cart=788',
      hasProgressBar: true,
      hasSocialShare: false,
    }
  },
  // ── Pure Donation Form sites ───────────────────────────────────────────────
  {
    id: 'yorkville', name: 'Yorkville Jewish Centre', url: 'https://donate.yorkvillejewishcentre.com',
    type: 'donationForm',
    config: {
      donatePath:      '/',
      presetAmounts:   6,
      hasNamedAmounts: true,
      checkoutViaCart: false,
    }
  },
  {
    id: 'clc', name: 'Chai Lifeline Canada', url: 'https://fundraise.chailifelinecanada.org',
    type: 'donationForm',
    config: {
      donatePath:      '/',
      presetAmounts:   8,
      checkoutViaCart: false,
      hasNav:          true,    // Has multi-page nav (hair donation, passover, etc.)
      navLinks: [
        { text: 'Hair Donation Program', path: '/hair-donation-program/' },
        { text: 'Passover Support',      path: '/chai-lifeline-canada-passover-support/' },
      ]
    }
  },
  {
    id: 'shomrim', name: 'Shomrim Toronto', url: 'https://shomrimtoronto.org',
    type: 'donationForm',
    config: {
      donatePath:      '/?lc-add-to-cart=3173',  // Direct checkout
      presetAmounts:   6,
      checkoutViaCart: true,  // Goes straight to checkout page
      checkoutPath:    '/lc/checkout/',
    }
  },
  {
    id: 'misaskim', name: 'Misaskim', url: 'https://misaskim.ca',
    type: 'donationForm',
    config: {
      donatePath:    '/donate',
      presetAmounts: 6,
    }
  },
  {
    id: 'fallen', name: 'Fallen Heroes', url: 'https://fallenh.org',
    type: 'donationForm',
    config: {
      donatePath:    '/',
      presetAmounts: 8,
      hasNav:        true,
      navLinks: [
        { text: 'Donate',         path: '/donate/' },
        { text: 'P2P Campaigns',  path: '/p2p-campaigns/' },
      ]
    }
  },
  {
    id: 'yeshiva', name: 'The Yeshiva', url: 'https://donate.theyeshiva.net',
    type: 'donationForm',
    config: {
      donatePath:    '/',
      presetAmounts: 0,  // Custom amount only
    }
  },
  {
    id: 'imf', name: 'Israel Magen Fund', url: 'https://israelmagenfund.org',
    type: 'donationForm',
    config: {
      donatePath:    '/donate/',
      presetAmounts: 0,
      hasNav:        true,
      navLinks: [
        { text: 'Empower Soldiers',    path: '/empower-soldiers/' },
        { text: 'Become a Fundraiser', path: '/fundraise' },
      ]
    }
  },
  {
    id: 'adi', name: 'ADI', url: 'https://adi-il.org',
    type: 'donationForm',
    config: {
      donatePath:    '/donate/',
      presetAmounts: 0,
    }
  },
  {
    id: 'ots', name: 'Ohr Torah Stone', url: 'https://fundraise.ots.org.il',
    type: 'donationForm',
    config: {
      donatePath:      '/',
      presetAmounts:   6,
      addToCartUrl:    'https://fundraise.ots.org.il/?lc-add-to-cart=64',
      checkoutViaCart: true,
    }
  },
  // ── Portal / Hub sites ────────────────────────────────────────────────────
  {
    id: 'nitzanim', name: 'Nitzanim', url: 'https://members.kehilatnitzanim.org',
    type: 'portal',
    config: {
      donatePath:    '/general-donation/',
      eventsPath:    '/events/',
      membershipPath:'/signup/',
      navLinks: [
        { text: 'Donate',        path: '/general-donation/' },
        { text: 'Events',        path: '/events/' },
        { text: 'Become Member', path: '/signup/' },
        { text: 'Sponsorships',  path: '/sponsorships' },
      ]
    }
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────────────────────────
const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', C = '\x1b[36m', RESET = '\x1b[0m';
function log(msg, t='info') { console.log((t==='pass'?G:t==='fail'?R:t==='warn'?Y:t==='section'?C:'')+msg+RESET); }

function chk(name, pass, detail='') {
  return { name, pass: Boolean(pass), detail: detail||(pass?'OK':'Failed') };
}

function skip(name, reason) {
  return { name, pass: true, detail: 'SKIPPED: '+reason };
}

async function saveToFirebase(fbPath, data) {
  try {
    const res = await fetch(`${FIREBASE_URL}/${fbPath}.json`, {
      method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data)
    });
    return res.ok;
  } catch(e) { return false; }
}

async function screenshot(page, label) {
  try {
    const ss = await page.screenshot({ type:'jpeg', quality:55, fullPage:false, clip:{x:0,y:0,width:1440,height:900} });
    return { label, url: page.url(), screenshot: ss.toString('base64'), ts: new Date().toISOString() };
  } catch { return null; }
}

async function goto(page, url, opts={}) {
  const resp = await page.goto(url, { waitUntil:'domcontentloaded', timeout:25000, ...opts });
  try { await page.waitForLoadState('networkidle', { timeout:8000 }); } catch {}
  await page.waitForTimeout(1500);
  return resp;
}

async function dismissCookies(page) {
  await page.evaluate(() => {
    document.querySelectorAll('button').forEach(b => {
      if (/accept|agree|allow|ok|got it/i.test(b.innerText)) {
        const wrap = b.closest('[class*="cookie"],[class*="consent"],[class*="gdpr"],[id*="cookie"]');
        if (wrap) b.click();
      }
    });
  });
  await page.waitForTimeout(500);
}

function mkPage(browser) {
  return browser.newContext({
    viewport: { width:1440, height:900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'en-US',
    extraHTTPHeaders: {
      'Accept-Language':'en-US,en;q=0.9',
      'sec-ch-ua':'"Chromium";v="124","Google Chrome";v="124"',
      'sec-ch-ua-mobile':'?0',
      'sec-ch-ua-platform':'"Windows"',
    },
  }).then(ctx => {
    ctx.addInitScript(() => {
      Object.defineProperty(navigator,'webdriver',{get:()=>undefined});
      window.chrome = { runtime:{} };
    });
    return ctx.newPage();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE A — HEADER checks
// Checks the REAL state of the header — broadened to work on all LevCharity
// sites regardless of theme (campaign-specific OR Elementor OR custom WP)
// ─────────────────────────────────────────────────────────────────────────────
async function testHeader(page, site) {
  const r = [];
  const cfg = site.config;

  const h = await page.evaluate(() => {
    // Header can be any of: LevCharity wrapper, campaign header, Elementor header, or <header>
    const hdrEl = document.querySelector(
      '.campaign-specific-header, .levcharity-default-header-wrapper, ' +
      '[class*="levcharity"][class*="header"], header, .site-header, ' +
      '[class*="elementor"][class*="header"]'
    );

    // Logo: custom-logo class OR any img inside header
    const logoImg = document.querySelector(
      'img.custom-logo, img[class*="levcharity-logo"], ' +
      'header img, .campaign-specific-header img, .levcharity-default-header-wrapper img, ' +
      '[class*="site-header"] img, [class*="brand"] img, img[alt*="logo" i]'
    );

    // Donate CTA: add-to-cart link, donate button, or any donate-labelled link
    const donateEl =
      document.querySelector('a[href*="lc-add-to-cart"]') ||
      document.querySelector('button.levcharity_button.primary_button') ||
      [...document.querySelectorAll('a,button')].find(el => /^donate/i.test(el.innerText?.trim()));

    // Navigation links: any nav or header anchors
    const navLinks = document.querySelectorAll(
      'nav a, header a, .levcharity-default-header a, .campaign-specific-header a'
    );
    const hasNav = navLinks.length >= 2;

    // Login / my account
    const loginEl = document.querySelector('a[href*="/my-account/"],a[href*="/login/"],a[href*="/my-account"]');

    // Participate / register
    const participateEl = document.querySelector('a[href*="/participate"]');

    // Overflow check
    let noOverflow = null;
    if (hdrEl) {
      const over = [...hdrEl.querySelectorAll('a,button,img')].filter(el => {
        const rect = el.getBoundingClientRect();
        return rect.width > 5 && rect.right > window.innerWidth + 10;
      });
      noOverflow = over.length === 0;
    }

    return {
      hasHeader:    !!hdrEl,
      headerTag:    hdrEl?.tagName + ' ' + (hdrEl?.className?.slice(0,40)||''),
      hasLogo:      !!logoImg,
      logoSrc:      logoImg?.src?.replace(/.*\//,'').slice(0,30),
      hasDonateBtn: !!donateEl,
      donateTxt:    donateEl?.innerText?.trim().slice(0,20),
      donateHref:   donateEl?.href?.slice(0,60),
      hasNavLinks:  hasNav,
      navCount:     navLinks.length,
      hasLoginBtn:  !!loginEl,
      hasParticipate: !!participateEl,
      noOverflow,
    };
  });

  // Core: site must have SOME header element
  r.push(chk('[Header] Header element present', h.hasHeader, h.headerTag||'Not found'));

  // Core: logo visible
  r.push(chk('[Header] Logo image present in header', h.hasLogo, h.logoSrc||'Not found'));

  // Core: donate CTA somewhere in header/nav
  r.push(chk('[Header] Donate CTA present', h.hasDonateBtn, h.donateTxt||h.donateHref||'Not found'));

  // Core: navigation has links
  r.push(chk('[Header] Navigation links present', h.hasNavLinks, h.navCount+' nav links'));

  // Informational: login/account button
  if (h.hasLoginBtn) r.push(chk('[Header] Login/My Account button present', true));

  // Informational: participate button (only if site expects it)
  if (cfg.participatePath) {
    r.push(chk('[Header] Participate/Join button present', h.hasParticipate, h.hasParticipate?'Found':'Missing — check if campaign is active'));
  }

  // Informational: no overflow
  if (h.noOverflow !== null) r.push(chk('[Header] No elements cut off viewport', h.noOverflow));

  return r;
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE B — FOOTER checks
// REQUIRED: LevCharity logo + working link
// INFORMATIONAL (warn but don't fail): charity name, email, copyright
// Sites using custom footers (Elementor/custom WP) still checked for LC branding
// ─────────────────────────────────────────────────────────────────────────────
async function testFooter(page, site) {
  const r = [];
  const f = await page.evaluate(() => {
    // LevCharity standard footer
    const lcFooter = document.querySelector('.levcharity-footer-bar-wrapper');
    const footerInner = document.querySelector('.footer-inner');

    // LevCharity logo anywhere in footer or page bottom
    // (can be in LC footer bar OR in a custom footer section)
    const lcLogoInFooter =
      document.querySelector('.levcharity-footer-bar-wrapper a[href*="levcharity.com"] img') ||
      document.querySelector('.footer-inner a[href*="levcharity.com"] img') ||
      document.querySelector('footer a[href*="levcharity.com"] img') ||
      document.querySelector('a[href*="levcharity.com"] img');

    const lcLink = document.querySelector('a[href*="levcharity.com"]');

    // Check LevCharity logo link actually works (not broken href)
    const lcLinkHref = lcLink?.href || '';
    const lcLinkWorking = lcLinkHref.includes('levcharity.com');

    // Optional info
    const charityName = document.querySelector('.footer-charity-info h3, .footer-charity-info > h3');
    const emailLink   = document.querySelector('.footer-inner a[href^="mailto:"], footer a[href^="mailto:"], a[href^="mailto:"]');
    const copyright   = document.querySelector('.footer-side-bottom, .footer-side-bottom p, [class*="copyright"]');

    // Footer links (any site footer)
    const footerLinks = [
      ...document.querySelectorAll('.footer-inner a, .levcharity-footer-bar-wrapper a, footer a')
    ].filter(a => a.href && a.href !== '#' && !a.href.startsWith('javascript'));

    return {
      hasLCFooter:   !!lcFooter,
      hasFooterInner:!!footerInner,
      hasLCLogo:     !!lcLogoInFooter,
      lcLogoSrc:     lcLogoInFooter?.src?.replace(/.*\//,'').slice(0,30),
      hasLCLink:     !!lcLink,
      lcLinkWorking,
      lcLinkHref,
      hasCharityName:!!charityName,
      charityNameTxt:charityName?.innerText?.trim().slice(0,30),
      hasEmailLink:  !!emailLink,
      emailHref:     emailLink?.href,
      hasCopyright:  !!copyright,
      footerLinksCount: footerLinks.length,
      footerLinksSample: footerLinks.slice(0,3).map(a=>a.href),
    };
  });

  // ── REQUIRED checks (fail if missing) ──────────────────────────────────────

  // LevCharity logo must appear somewhere visible
  r.push(chk('[Footer] LevCharity logo present', f.hasLCLogo,
    f.hasLCLogo ? f.lcLogoSrc : 'LevCharity "Powered by" logo not found anywhere on page'));

  // LevCharity link must work
  r.push(chk('[Footer] LevCharity link works', f.lcLinkWorking,
    f.lcLinkWorking ? f.lcLinkHref : 'Link to levcharity.com missing or broken'));

  // Footer must have at least some links
  r.push(chk('[Footer] Footer has working links', f.footerLinksCount > 0,
    f.footerLinksCount + ' footer links found'));

  // ── INFORMATIONAL checks (pass=true always — logged as info) ───────────────

  // Charity name in footer (nice to have, not required)
  r.push(Object.assign(chk('[Footer] Charity name in footer', true,
    f.hasCharityName ? f.charityNameTxt : 'Not present (informational only)'),
    {pass: true}));  // Always pass — just informational

  // Email contact (many sites omit this legitimately)
  r.push(Object.assign(chk('[Footer] Contact email', true,
    f.hasEmailLink ? f.emailHref : 'No mailto link (informational only)'),
    {pass: true}));

  // Copyright text
  r.push(Object.assign(chk('[Footer] Copyright text', true,
    f.hasCopyright ? 'Present' : 'Not found (informational only)'),
    {pass: true}));

  return r;
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE C — HERO checks
// ─────────────────────────────────────────────────────────────────────────────
async function testHero(page, site) {
  const r = [];
  const h = await page.evaluate(() => ({
    wpBlocks:   !!document.querySelector('.wp-site-blocks'),
    heroSect:   !!document.querySelector('.levcharity_hero_section'),
    heroThumb:  !!document.querySelector('img.levcharity_hero_thumbnail'),
    bannerImg:  !!document.querySelector('.levcharity_hero_section img,.banner_image'),
  }));
  r.push(chk('[Hero] Page content loads (.wp-site-blocks)', h.wpBlocks));
  r.push(chk('[Hero] Hero section or thumbnail present', h.heroSect||h.heroThumb||h.bannerImg,
    h.heroSect?'Section found':h.heroThumb?'Thumbnail found':h.bannerImg?'Banner found':'None detected'));
  return r;
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE D — FUNDRAISER LIST checks (team campaign pages)
// ─────────────────────────────────────────────────────────────────────────────
async function testFundraiserList(page, site) {
  const r = [];
  const cfg = site.config;
  const searchSel = cfg.searchSelector || 'input[name="participants-list-search"]';

  const l = await page.evaluate((sSel) => ({
    tabs:         !!document.querySelector('.team-campaign-list-tabs'),
    tabItems:     document.querySelectorAll('.team-campaign-list-tab').length,
    activeTab:    document.querySelector('.team-campaign-list-tab.current')?.innerText?.trim(),
    cards:        document.querySelectorAll('.team-campaign-participant-item').length,
    searchInput:  !!document.querySelector(sSel),
    sortDropdown: !!document.querySelector('select[name="participants-list-sorting"]'),
    hasPagination:!!document.querySelector('.levcharity-pagination,.page-numbers'),
    donorSearch:  !!document.querySelector('input[name="donor-list-search"]'),
    donorSort:    !!document.querySelector('select[name="donor-list-sorting"]'),
    firstCardHref:document.querySelector('.team-campaign-participant-item a')?.href,
    firstCardName:document.querySelector('.team-campaign-participant-item')?.innerText?.trim().split('\n')[0],
  }), searchSel);

  r.push(chk('[FundraiserList] Fundraiser cards displayed', l.cards>0, l.cards+' cards'));
  if (l.tabs) {
    r.push(chk('[FundraiserList] Tab navigation present', true, l.tabItems+' tabs, active: '+(l.activeTab||'?')));
  }
  r.push(chk('[FundraiserList] Search input present', l.searchInput));
  if (l.sortDropdown) r.push(chk('[FundraiserList] Sort dropdown present', true));
  if (l.hasPagination) r.push(chk('[FundraiserList] Pagination present', true));
  if (l.donorSearch)   r.push(chk('[FundraiserList] Donor search present', true));
  if (l.donorSort)     r.push(chk('[FundraiserList] Donor sort present', true));

  // Interactive: search 'campaign' — works on all sites, triggers dropdown or list filter
  if (!cfg.cloudflareBlocked) {
    try {
      const searchTerm = 'campaign';
      let inp = null;

      // First: try visible participant-list search
      if (l.searchInput) {
        const direct = page.locator(searchSel).first();
        if (await direct.isVisible({ timeout:2000 }).catch(()=>false)) inp = direct;
      }

      // Second: try clicking a search icon to reveal a dropdown input
      if (!inp) {
        const iconSels = ['.levit-open-popup-button','button[class*="search"]','a[class*="search"]','.jet-ajax-search__submit','[aria-label*="search" i]'];
        for (const sel of iconSels) {
          const icon = page.locator(sel).first();
          if (await icon.isVisible({ timeout:1500 }).catch(()=>false)) {
            await icon.click().catch(()=>{});
            await page.waitForTimeout(600);
            break;
          }
        }
        const revealSels = ['input[name="participants-list-search"]','input[name="ambassadors_search_input"]','input[type="search"]','.jet-ajax-search__input','input[placeholder*="Search" i]'];
        for (const sel of revealSels) {
          const candidate = page.locator(sel).first();
          if (await candidate.isVisible({ timeout:2000 }).catch(()=>false)) { inp = candidate; break; }
        }
      }

      if (!inp) {
        r.push(chk('[FundraiserList] Search responds to input', false, 'No search input found after trying icon click'));
      } else {
        await inp.fill(searchTerm);
        await page.waitForTimeout(3000);

        // Check for results: dropdown OR filtered participant list OR page content change
        const results = await page.evaluate((term) => {
          // Dropdown results (jet-ajax-search style)
          const dropdownSels = ['.jet-ajax-search__results-holder','.jet-ajax-search__results','[class*="search-results"]','[role="listbox"]','[class*="suggest"]','[class*="autocomplete"]'];
          for (const sel of dropdownSels) {
            const el = document.querySelector(sel);
            if (el && el.offsetParent !== null) {
              const items = el.querySelectorAll('a,li,[class*="result-item"]');
              const vis = [...items].filter(i=>i.offsetParent!==null).length;
              if (vis > 0) return { type:'dropdown', count:vis, text:'Dropdown: '+vis+' results' };
            }
          }
          // Filtered participant list
          const filtered = [...document.querySelectorAll('.team-campaign-participant-item')].filter(e=>e.offsetParent!==null).length;
          if (filtered > 0) return { type:'list', count:filtered, text:'List: '+filtered+' filtered results' };
          // Term appears in page (url-based search)
          if (document.body.innerText.toLowerCase().includes(term.toLowerCase())) return { type:'content', count:1, text:'Term found in page' };
          return { type:'none', count:0, text:'No results detected' };
        }, searchTerm);

        await inp.fill('').catch(()=>{});
        await page.waitForTimeout(800);

        const responded = results.type !== 'none';
        r.push(chk('[FundraiserList] Search responds to "'+searchTerm+'"', responded,
          responded ? results.text : 'No dropdown or filtered results detected'));
      }
    } catch(e) {
      r.push(chk('[FundraiserList] Search interactive test', false, e.message.slice(0,80)));
    }
  }

  return { results: r, firstCardHref: l.firstCardHref };
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE E — FUNDRAISER DETAIL PAGE checks
// ─────────────────────────────────────────────────────────────────────────────
async function testFundraiserDetail(page, site, detailUrl) {
  const r = [];
  if (!detailUrl) {
    r.push(skip('[FundraiserDetail] All checks', 'No campaign detail URL found'));
    return r;
  }

  await goto(page, detailUrl);
  const cfg = site.config;

  const d = await page.evaluate(() => ({
    banner:      !!document.querySelector('.levcharity_hero_section img,.campaign-specific-header,.banner_image'),
    featuredImg: !!document.querySelector('.featured_image_wrapper img,.featured_image img'),
    donateBtn:   !!document.querySelector('button.levcharity_button.primary_button.large'),
    donateBtnTxt:document.querySelector('button.levcharity_button.primary_button.large')?.innerText?.trim(),
    h1:          !!document.querySelector('h1.levcharity_heading'),
    title:       document.querySelector('h1.levcharity_heading')?.innerText?.trim().slice(0,50),
    progressBar: !!document.querySelector('.levcharity_progressbar_container'),
    raised:      document.querySelector('h2.levcharity_heading.campaign-goal-raised,.amounts')?.innerText?.trim().slice(0,30),
    goalAmt:     !!document.querySelector('.amounts > b,.campaign-goal'),
    donors:      document.querySelectorAll('div.campaign-donor-item').length,
    socialBlock: !!document.querySelector('.wp-block-custom-inline-social-share-levit-block'),
    fbShare:     !!document.querySelector('a[href^="https://www.facebook.com/sharer/"]'),
    twShare:     !!document.querySelector('a[href^="https://twitter.com/intent/"]'),
    waShare:     !!document.querySelector('a[href^="https://api.whatsapp.com/"]'),
    qrCode:      !!document.querySelector('.qr_code'),
    tabs:        !!document.querySelector('.team-campaign-list-tabs'),
    campaignBlk: !!document.querySelector('.campaign-block'),
  }));

  r.push(chk('[FundraiserDetail] Page loaded', true, detailUrl));
  r.push(chk('[FundraiserDetail] Banner/hero image', d.banner));
  if (d.featuredImg) r.push(chk('[FundraiserDetail] Featured/profile image', true));
  r.push(chk('[FundraiserDetail] Donate button visible', d.donateBtn, d.donateBtnTxt||'Not found'));
  r.push(chk('[FundraiserDetail] Campaign title (h1)', d.h1, d.title||'Missing'));
  r.push(chk('[FundraiserDetail] Progress bar', d.progressBar));
  r.push(chk('[FundraiserDetail] Raised amount displayed', !!d.raised, d.raised||'Missing'));
  r.push(chk('[FundraiserDetail] Donor items visible', d.donors>0, d.donors+' donors'));

  if (cfg.hasSocialShare || d.socialBlock) {
    r.push(chk('[FundraiserDetail] Social share block', d.socialBlock));
    r.push(chk('[FundraiserDetail] Facebook share link', d.fbShare));
    r.push(chk('[FundraiserDetail] Twitter/X share link', d.twShare));
    r.push(chk('[FundraiserDetail] WhatsApp share link', d.waShare));
  }

  if (d.qrCode) r.push(chk('[FundraiserDetail] QR code section', true));
  if (d.tabs)   r.push(chk('[FundraiserDetail] Tabs visible', true));

  // Interactive: click donate → should navigate to checkout
  if (d.donateBtn && !cfg.cloudflareBlocked) {
    try {
      await page.click('button.levcharity_button.primary_button.large');
      await page.waitForTimeout(3000);
      const after = page.url();
      const isCheckout = after.includes('checkout')||after.includes('cart');
      r.push(chk('[FundraiserDetail] Donate button → checkout URL', isCheckout, after));
    } catch(e) {
      r.push(chk('[FundraiserDetail] Donate button → checkout', false, e.message.slice(0,60)));
    }
  }

  return r;
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE F — DONATIONS & ABOUT section checks
// ─────────────────────────────────────────────────────────────────────────────
async function testDonationsAbout(page, site, campaignUrl) {
  const r = [];
  await goto(page, campaignUrl);

  const da = await page.evaluate(() => ({
    donationsSection: !!document.querySelector('.donations_part,.donatons_and_about'),
    totalDonors:      !!document.querySelector('.mini_info_box.total_donors'),
    donorsLabel:      document.querySelector('.mini_info_box.total_donors .levcharity_paragraph')?.innerText?.trim(),
    ambassadors:      !!document.querySelector('.mini_info_box.ambassadors'),
    participateBtn:   !!document.querySelector('.mini_info_box a[href*="/participate/"]'),
    recentDonations:  !!document.querySelector('.recent_donations.campaign_top_donors,.donations_part .recent_donations'),
    firstDonor:       !!document.querySelector('div.campaign-donor-item:first-of-type,.campaign-donor-item:nth-of-type(1)'),
    donorName:        !!document.querySelector('.campaign-donor-item .donor_name'),
    donorAmount:      !!document.querySelector('.campaign-donor-item .donation_amount_total,.campaign-donor-item .donation_amount'),
    viewAllLink:      document.querySelector('a[href="#donations_list"]')?.innerText?.trim(),
    aboutPart:        !!document.querySelector('.about_part'),
    aboutHeading:     !!document.querySelector('h2.levcharity_heading.heading_and_desc_heading'),
    aboutParas:       document.querySelectorAll('.about_part > p').length,
    ambassadorsSection:!!document.querySelector('.ambassadors_section_wrapper,.ambassadors_section'),
    ambassadorsSearch: !!document.querySelector('input[name="ambassadors_search_input"]'),
    fundraiserCount:   document.querySelectorAll('.ambassadors_section a[href]').length,
  }));

  if (!da.donationsSection && !da.ambassadorsSection) {
    r.push(skip('[DonationsAbout] All checks', 'Site does not use this module'));
    return r;
  }

  r.push(chk('[DonationsAbout] Donations section present', da.donationsSection));
  r.push(chk('[DonationsAbout] Total donors widget', da.totalDonors, da.donorsLabel||'Present'));
  r.push(chk('[DonationsAbout] Ambassadors widget', da.ambassadors));
  r.push(chk('[DonationsAbout] Participate button in widget', da.participateBtn));
  r.push(chk('[DonationsAbout] Recent donations list', da.recentDonations));
  r.push(chk('[DonationsAbout] Donor item visible', da.firstDonor));
  r.push(chk('[DonationsAbout] Donor name shown', da.donorName));
  r.push(chk('[DonationsAbout] Donor amount shown', da.donorAmount));
  r.push(chk('[DonationsAbout] "View All Donations" link', !!da.viewAllLink, da.viewAllLink||'Missing'));
  r.push(chk('[DonationsAbout] About section present', da.aboutPart));
  if (da.aboutPart) {
    r.push(chk('[DonationsAbout] About heading present', da.aboutHeading));
    r.push(chk('[DonationsAbout] About paragraphs (≥1)', da.aboutParas>0, da.aboutParas+' paragraphs'));
  }
  if (site.config.hasAmbassadors) {
    r.push(chk('[DonationsAbout] Top fundraisers section', da.ambassadorsSection));
    r.push(chk('[DonationsAbout] Fundraiser search input', da.ambassadorsSearch));
    r.push(chk('[DonationsAbout] Fundraiser cards visible', da.fundraiserCount>0, da.fundraiserCount+' links'));
  }
  return r;
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE G — CHECKOUT FORM checks (43-field validation from Ghost Inspector)
// ─────────────────────────────────────────────────────────────────────────────
async function testCheckout(page, site, checkoutUrl) {
  const r = [];
  if (!checkoutUrl) {
    r.push(skip('[Checkout] All checks', 'No checkout URL available'));
    return r;
  }

  if (site.config.cloudflareBlocked) {
    r.push(skip('[Checkout] All checks', 'Site blocks CI IPs via Cloudflare'));
    return r;
  }

  try {
    await goto(page, checkoutUrl);
    await dismissCookies(page);
    await page.evaluate(() => window.scrollBy(0, 200));
    await page.waitForTimeout(1000);

    // Give Stripe and payment widgets time to render
    await page.waitForTimeout(2500);

    const co = await page.evaluate(() => {
      const url = window.location.href;
      const isCheckout = url.includes('checkout') || url.includes('cart') || url.includes('/lc/');
      const hasAmounts = !!(
        document.querySelector('.levcharity_form__donation_list_item.predefined_amount') ||
        document.querySelector('.levcharity_form__donation_amount') ||
        document.querySelector('label.predefined_title') ||
        document.querySelectorAll('[class*="predefined"]').length > 0
      );
      const presetCount = document.querySelectorAll('.levcharity_form__donation_list_item.predefined_amount').length;
      const stripeEl = document.querySelectorAll('.StripeElement').length;
      const stripeIframe = document.querySelectorAll('iframe[name*="stripe"],iframe[src*="stripe"]').length;
      const hasStripe = stripeEl > 0 || stripeIframe > 0 || typeof window.Stripe !== 'undefined';
      const hasPayment = !!(
        document.querySelector('.payment-gateway-item,.payment-gateways,#payment,.levcharity-payment') ||
        document.querySelector('[class*="payment"]')
      );
      return {
        url, isCheckout, hasAmounts, presetCount,
        firstName:  !!document.querySelector('input[name="firstName"],#billing_first_name'),
        lastName:   !!document.querySelector('input[name="lastName"],#billing_last_name'),
        email:      !!document.querySelector('input[name="email"],#billing_email'),
        phone:      !!document.querySelector('input[name="phone"],#billing_phone'),
        address:    !!document.querySelector('input[name="address"],#billing_address_1'),
        city:       !!document.querySelector('input[name="city"],#billing_city'),
        postcode:   !!document.querySelector('input[name="postcode"],#billing_postcode'),
        ccFee:      !!document.querySelector('label[for="cc_fee"],input#cc_fee,[class*="cc_fee"],[class*="cc-fee"]'),
        orderTotal: !!document.querySelector('tr.order-total,.order-total,[class*="order-total"]'),
        placeOrder: !!document.querySelector('button[name="woocommerce_checkout_place_order"],#place_order,button[class*="place_order"]'),
        hasPayment, hasStripe, stripeEl, stripeIframe,
        lcLogo:     !!document.querySelector('img.levcharity-logo,.levcharity-logo,.levcharity-checkout-logo img'),
        campaignMsg:!!document.querySelector('.campaign-message-container,input[name="campaignMessageName"]'),
        teamSearch: !!document.querySelector('.form-team-search'),
      };
    });

    r.push(chk('[Checkout] Landed on checkout page', co.isCheckout, co.url));
    r.push(chk('[Checkout] Donation amounts present', co.hasAmounts, co.presetCount+' preset amounts'));
    r.push(chk('[Checkout] First name field', co.firstName));
    r.push(chk('[Checkout] Last name field', co.lastName));
    r.push(chk('[Checkout] Email field', co.email));
    r.push(chk('[Checkout] Phone field', co.phone));
    r.push(chk('[Checkout] Address field', co.address));
    r.push(chk('[Checkout] City field', co.city));
    r.push(chk('[Checkout] Postcode / zip field', co.postcode));
    r.push(chk('[Checkout] CC fee cover option', co.ccFee));
    r.push(chk('[Checkout] Order total visible', co.orderTotal));
    r.push(chk('[Checkout] Place Order button', co.placeOrder));
    r.push(chk('[Checkout] Payment section present', co.hasPayment));
    // Stripe renders async — not a hard fail, just informational
    r.push(Object.assign(
      chk('[Checkout] Stripe payment fields', true,
        co.hasStripe ? (co.stripeEl+' StripeElement + '+co.stripeIframe+' iframe') : 'Not detected (renders async)'),
      {pass: true}
    ));
    if (co.lcLogo)     r.push(chk('[Checkout] LevCharity logo visible', true));
    if (co.campaignMsg)r.push(chk('[Checkout] Campaign message section', true));
    if (co.teamSearch) r.push(chk('[Checkout] Team/fundraiser search', true));
  } catch(e) {
    r.push(chk('[Checkout] Page loaded', false, e.message.slice(0,80)));
  }
  return r;
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE H — DONATION FORM checks (for pure-form sites)
// ─────────────────────────────────────────────────────────────────────────────
async function testDonationForm(page, site) {
  const r = [];
  const cfg = site.config;
  const donatePage = site.url + cfg.donatePath;

  await goto(page, donatePage);
  await dismissCookies(page);
  await page.waitForTimeout(1000);

  const f = await page.evaluate(() => ({
    url:          window.location.href,
    isDonateForm: !!document.querySelector('.levcharity_form.donation_form,form.levcharity_form'),
    donateBtn:    !!(document.querySelector('a[href*="lc-add-to-cart"]')||document.querySelector('button.levcharity_button.primary_button')),
    donateBtnTxt: document.querySelector('button.levcharity_button.primary_button')?.innerText?.trim(),
    presets:      document.querySelectorAll('.levcharity_form__donation_list_item.predefined_amount').length,
    hasAmountFld: !!document.querySelector('input[name="donation_amount"],.levcharity_form__donation_amount'),
    hasCurrency:  !!document.querySelector('.lc-currency-selector,[class*="currency"]'),
    hasFreq:      !!document.querySelector('[class*="frequency"],[class*="recurring"]'),
    hasTribute:   !!document.querySelector('[class*="tribute"],[class*="honor"]'),
    pageLoaded:   document.querySelectorAll('[class*="levcharity"]').length > 0,
  }));

  r.push(chk('[DonationForm] Page loaded', f.pageLoaded, f.url));
  r.push(chk('[DonationForm] Donation form present', f.isDonateForm||f.donateBtn));
  r.push(chk('[DonationForm] Donate button present', f.donateBtn, f.donateBtnTxt||'Found'));
  if (cfg.presetAmounts > 0) {
    r.push(chk('[DonationForm] Preset donation amounts', f.presets>=cfg.presetAmounts, f.presets+' preset amounts (expected '+cfg.presetAmounts+')'));
  }
  if (f.hasAmountFld) r.push(chk('[DonationForm] Custom amount field', true));
  if (f.hasCurrency)  r.push(chk('[DonationForm] Currency selector present', true));
  if (f.hasFreq)      r.push(chk('[DonationForm] Recurring/frequency option', true));

  // Navigate to checkout by clicking donate
  if (f.donateBtn && !cfg.checkoutViaCart) {
    try {
      await dismissCookies(page);
      const btn = await page.$('button.levcharity_button.primary_button');
      if (btn) {
        await btn.click();
        await page.waitForTimeout(3000);
        const afterUrl = page.url();
        r.push(chk('[DonationForm] Donate → checkout page', afterUrl.includes('checkout')||afterUrl.includes('cart'), afterUrl));
      }
    } catch(e) {
      r.push(chk('[DonationForm] Donate → checkout', false, e.message.slice(0,60)));
    }
  }

  if (cfg.hasNav && cfg.navLinks) {
    for (const nav of cfg.navLinks.slice(0,2)) {
      try {
        const resp = await goto(page, site.url + nav.path);
        const ok = (resp?.status()||0) < 400;
        r.push(chk('[DonationForm] Nav: '+nav.text+' loads', ok, site.url+nav.path));
      } catch(e) {
        r.push(chk('[DonationForm] Nav: '+nav.text, false, e.message.slice(0,50)));
      }
    }
  }

  return r;
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE I — P2P CAMPAIGN PAGE checks (individual fundraiser pages)
// ─────────────────────────────────────────────────────────────────────────────
async function testP2PCampaign(page, site) {
  const r = [];
  const cfg = site.config;

  // Load list page first
  if (cfg.listPath) {
    try {
      await goto(page, site.url + cfg.listPath);
      const list = await page.evaluate(() => ({
        hasCampaignCards: !!(document.querySelector('[class*="p2p-campaign"],[class*="campaign-card"],[class*="participant-item"]')||
                            document.querySelectorAll('a[href*="/p2p-campaign/"]').length > 0),
        campaignLinks:    Array.from(document.querySelectorAll('a[href*="/p2p-campaign/"]')).map(a=>a.href).slice(0,3),
        hasSignupBtn:     !!document.querySelector('a[href*="p2p-create-campaign"],a[href*="participate"],a[href*="signup"]'),
      }));
      r.push(chk('[P2P] Campaign list page loads', true, site.url+cfg.listPath));
      if (list.campaignLinks.length) {
        r.push(chk('[P2P] Campaign cards/links present', true, list.campaignLinks.length+' links'));
      }
      if (list.hasSignupBtn) r.push(chk('[P2P] Sign up / Create campaign button', true));
    } catch(e) {
      r.push(chk('[P2P] Campaign list page', false, e.message.slice(0,60)));
    }
  }

  // Test the representative campaign page
  try {
    await goto(page, site.url + cfg.campaignPath);
    await dismissCookies(page);
    await page.waitForTimeout(1000);

    const p = await page.evaluate(() => ({
      url:         window.location.href,
      hasHero:     !!document.querySelector('.levcharity_hero_section img,.banner_image'),
      hasTitle:    !!document.querySelector('h1.levcharity_heading,h1'),
      hasDonateBtn:!!(document.querySelector('a[href*="lc-add-to-cart"]')||document.querySelector('button.levcharity_button.primary_button')),
      donateTxt:   (document.querySelector('a[href*="lc-add-to-cart"]')||document.querySelector('button.levcharity_button.primary_button'))?.innerText?.trim(),
      hasProgress: !!document.querySelector('.levcharity_progressbar_container'),
      hasRaised:   !!document.querySelector('.amounts,h2.levcharity_heading.campaign-goal-raised'),
      raisedTxt:   document.querySelector('.amounts,h2.levcharity_heading.campaign-goal-raised')?.innerText?.trim().slice(0,30),
      hasDonors:   document.querySelectorAll('.campaign-donor-item').length,
      hasSocial:   !!document.querySelector('.wp-block-custom-inline-social-share-levit-block'),
      fbShare:     !!document.querySelector('a[href^="https://www.facebook.com/sharer/"]'),
      waShare:     !!document.querySelector('a[href^="https://api.whatsapp.com/"]'),
      hasAbout:    !!document.querySelector('.about_part,p.campaign_description,[class*="about"]'),
    }));

    r.push(chk('[P2P] Campaign page loads', true, p.url));
    r.push(chk('[P2P] Hero/banner image', p.hasHero));
    r.push(chk('[P2P] Campaign title', p.hasTitle));
    r.push(chk('[P2P] Donate button', p.hasDonateBtn, p.donateTxt||'Found'));
    r.push(chk('[P2P] Progress bar', p.hasProgress));
    r.push(chk('[P2P] Raised amount', p.hasRaised, p.raisedTxt||'Missing'));
    if (p.hasDonors) r.push(chk('[P2P] Donor items visible', true, p.hasDonors+' donors'));

    if (cfg.hasSocialShare) {
      r.push(chk('[P2P] Social share block', p.hasSocial));
      r.push(chk('[P2P] Facebook share link', p.fbShare));
      r.push(chk('[P2P] WhatsApp share link', p.waShare));
    }

    // Click donate → checkout
    if (p.hasDonateBtn) {
      try {
        const addToCartEl = await page.$('a[href*="lc-add-to-cart"]');
        const donateBtnEl = await page.$('button.levcharity_button.primary_button');
        if (addToCartEl) {
          await goto(page, await addToCartEl.getAttribute('href'));
        } else if (donateBtnEl) {
          await donateBtnEl.click();
          await page.waitForTimeout(3000);
        }
        const afterUrl = page.url();
        r.push(chk('[P2P] Donate → checkout URL', afterUrl.includes('checkout')||afterUrl.includes('cart'), afterUrl));
      } catch(e) {
        r.push(chk('[P2P] Donate → checkout', false, e.message.slice(0,60)));
      }
    }
  } catch(e) {
    r.push(chk('[P2P] Campaign page loaded', false, e.message.slice(0,80)));
  }

  return r;
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE J — PORTAL checks (multi-page hub sites like Nitzanim)
// ─────────────────────────────────────────────────────────────────────────────
async function testPortal(page, site) {
  const r = [];
  const cfg = site.config;

  // Check homepage
  const hp = await page.evaluate(() => ({
    hasNav:   !!document.querySelector('nav,header,[class*="header"],[class*="nav"]'),
    hasLinks: document.querySelectorAll('a[href]').length,
    loaded:   !!document.querySelector('.wp-site-blocks,main,article,[class*="content"]'),
  }));
  r.push(chk('[Portal] Homepage loads with content', hp.loaded));
  r.push(chk('[Portal] Navigation/links present', hp.hasNav));

  // Test each nav link
  for (const nav of (cfg.navLinks||[])) {
    try {
      const resp = await goto(page, site.url + nav.path);
      const statusOk = (resp?.status()||0) < 400;
      r.push(chk('[Portal] '+nav.text+' page loads', statusOk, site.url+nav.path));
    } catch(e) {
      r.push(chk('[Portal] '+nav.text+' page', false, e.message.slice(0,50)));
    }
  }

  // Test donate page specifically
  if (cfg.donatePath) {
    await goto(page, site.url + cfg.donatePath);
    const dp = await page.evaluate(() => ({
      hasDonateBtn:!!(document.querySelector('button.levcharity_button.primary_button')||document.querySelector('a[href*="lc-add-to-cart"]')),
      hasDonateForm:!!document.querySelector('.levcharity_form.donation_form,form.levcharity_form'),
      btnText:document.querySelector('button.levcharity_button.primary_button')?.innerText?.trim(),
    }));
    r.push(chk('[Portal] Donate page has donate button', dp.hasDonateBtn, dp.btnText||'Found'));
  }

  // Test events page
  if (cfg.eventsPath) {
    await goto(page, site.url + cfg.eventsPath);
    const ep = await page.evaluate(() => ({
      pageLoads: !!document.querySelector('.wp-site-blocks,main'),
      hasEventContent: !!(document.querySelector('[class*="event"]')||document.body.innerText.includes('event')||document.body.innerText.includes('Event')),
    }));
    r.push(chk('[Portal] Events page loads', ep.pageLoads, site.url+cfg.eventsPath));
  }

  return r;
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE K — SIGNUP FORM checks (participate / register flow)
// ─────────────────────────────────────────────────────────────────────────────
async function testSignup(page, site) {
  const r = [];
  const cfg = site.config;
  if (!cfg.participatePath && !cfg.signupPath) {
    r.push(skip('[Signup] All checks', 'No participate path configured'));
    return r;
  }

  const signupUrl = site.url + (cfg.participatePath||cfg.signupPath);
  try {
    await goto(page, signupUrl);
    const s = await page.evaluate(() => ({
      hasForm:     !!document.querySelector('#teams-2,.signup-form,[class*="signup"],[class*="register"]'),
      firstName:   !!document.querySelector('#teams-2-first-name,input[name="first_name"],#first-name'),
      lastName:    !!document.querySelector('#teams-2-last-name,input[name="last_name"],#last-name'),
      email:       !!document.querySelector('#teams-2-email,input[type="email"]'),
      phone:       !!document.querySelector('#teams-2-phone-number,input[type="tel"]'),
      password:    !!document.querySelector('#teams-2-password,input[type="password"]'),
      submitBtn:   !!document.querySelector('button[type="submit"],.step-btn,#teams-2 button'),
    }));
    r.push(chk('[Signup] Form page loads', true, signupUrl));
    r.push(chk('[Signup] Form wrapper present', s.hasForm));
    r.push(chk('[Signup] First name field', s.firstName));
    r.push(chk('[Signup] Last name field', s.lastName));
    r.push(chk('[Signup] Email field', s.email));
    if (s.phone)    r.push(chk('[Signup] Phone field', true));
    if (s.password) r.push(chk('[Signup] Password field', true));
    r.push(chk('[Signup] Submit/Next button', s.submitBtn));
  } catch(e) {
    r.push(chk('[Signup] Page loaded', false, e.message.slice(0,60)));
  }
  return r;
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE L — CHAIATHON: Search → No-Results → Pagination regression test
// ─────────────────────────────────────────────────────────────────────────────
async function testChaiathonSearchPagination(page) {
  const r = [];
  const URL = 'https://chaiathon.org/fundraisers/';
  const TERM = 'abscjgdhuil';

  try {
    await goto(page, URL);

    // Baseline
    const base = await page.evaluate(() => {
      const pag = document.querySelector('.levcharity-pagination');
      const pagStyle = pag ? window.getComputedStyle(pag) : null;
      return {
        cards:        document.querySelectorAll('.team-campaign-participant-item').length,
        searchInput:  !!document.querySelector('input[name="participants-list-search"]'),
        pagVisible:   pag ? (pagStyle.display!=='none' && pag.offsetHeight>0) : false,
        visibleBtns:  [...document.querySelectorAll('.pagination-button.pagination-page-number')].filter(b=>window.getComputedStyle(b).display!=='none').length,
      };
    });

    r.push(chk('[Search/Pagination] Step 1: Page loaded with cards', base.cards>0, base.cards+' cards'));
    r.push(chk('[Search/Pagination] Step 1: Search input present', base.searchInput));
    r.push(chk('[Search/Pagination] Step 1: Pagination visible before search', base.pagVisible, base.visibleBtns+' page buttons'));

    // Screenshot: baseline
    const ss0 = await screenshot(page, 'Step 1: Baseline — cards and pagination loaded');
    if (ss0) r.push({...ss0, name:'[Search/Pagination] Step 1: Baseline screenshot', pass:true, detail:base.cards+' cards, pagination visible'});

    if (!base.searchInput) {
      r.push(chk('[Search/Pagination] Cannot proceed — search input missing', false));
      return r;
    }

    // Type garbage search term
    const searchSel = 'input[name="participants-list-search"]';
    await page.click(searchSel);
    await page.fill(searchSel, TERM);
    await page.evaluate((sel) => {
      const inp = document.querySelector(sel);
      ['input','change','keyup'].forEach(e => inp.dispatchEvent(new Event(e,{bubbles:true})));
    }, searchSel);

    // Screenshot: just after typing
    const ss1 = await screenshot(page, 'Step 2: Search term typed — waiting for no-results');
    if (ss1) r.push({...ss1, name:'[Search/Pagination] Step 2: Search term entered', pass:true, detail:'Term: '+TERM});

    // Wait for no-results
    try {
      await page.waitForFunction(() =>
        /nothing found|no results/i.test(document.body.innerText) ||
        [...document.querySelectorAll('.team-campaign-participant-item')].filter(e=>e.offsetParent!==null).length === 0,
        { timeout:8000 }
      );
    } catch {}
    await page.waitForTimeout(1500);

    // Screenshot: no-results state
    const ss2 = await screenshot(page, 'Step 3: No-results state visible');
    if (ss2) r.push({...ss2, name:'[Search/Pagination] Step 3: No-results state', pass:true, detail:'Checking pagination...'});

    // Measure state after search
    const after = await page.evaluate(() => {
      const pag = document.querySelector('.levcharity-pagination');
      const pagStyle = pag ? window.getComputedStyle(pag) : null;
      const visibleBtns = [...document.querySelectorAll('.pagination-button.pagination-page-number')]
        .filter(b => window.getComputedStyle(b).display !== 'none');
      return {
        visibleCards:    [...document.querySelectorAll('.team-campaign-participant-item')].filter(e=>e.offsetParent!==null).length,
        noResultsText:   /nothing found|no results/i.test(document.body.innerText),
        pagVisible:      pag ? (pagStyle.display!=='none' && pag.offsetHeight>0) : false,
        pagDisplay:      pagStyle?.display||'N/A',
        pagHeight:       pag?.offsetHeight||0,
        visibleBtnCount: visibleBtns.length,
        visibleBtnTexts: visibleBtns.slice(0,5).map(b=>b.innerText.trim()),
      };
    });

    log(`    Search: "${TERM}" → cards:${after.visibleCards}, "Nothing found.":${after.noResultsText}`, 'info');
    log(`    Pagination: display=${after.pagDisplay} height=${after.pagHeight}px, visible buttons: ${after.visibleBtnCount}`, 'info');

    r.push(chk('[Search/Pagination] "Nothing found." message appears', after.noResultsText));
    r.push(chk('[Search/Pagination] Zero cards visible with no results', after.visibleCards===0, after.visibleCards===0?'Correct':'BUG: '+after.visibleCards+' cards still showing'));

    // THE KEY CHECK
    const pagHidden = !after.pagVisible && after.visibleBtnCount===0;
    r.push(chk('[Search/Pagination] Pagination hidden when no results',
      pagHidden,
      pagHidden ? 'Pagination correctly hidden'
                : 'BUG: Pagination still visible — display:'+after.pagDisplay+', '+after.visibleBtnCount+' page buttons: ['+after.visibleBtnTexts.join(', ')+']'
    ));

    // Screenshot: the bug (scroll pagination into view)
    await page.evaluate(() => {
      const pag = document.querySelector('.levcharity-pagination');
      if (pag) pag.scrollIntoView({behavior:'instant',block:'center'});
    });
    await page.waitForTimeout(300);
    const ss3 = await screenshot(page, 'Step 4: '+(pagHidden?'Pagination hidden ✓':'BUG — pagination still visible'));
    if (ss3) r.push({...ss3, name:'[Search/Pagination] Step 4: '+(pagHidden?'PASS — Pagination correctly hidden':'FAIL — Pagination visible with 0 results'), pass:pagHidden, detail:pagHidden?'OK':'BUG: '+after.visibleBtnCount+' buttons visible'});

    // Clear and verify recovery
    await page.fill(searchSel, '');
    await page.evaluate((sel) => {
      const inp = document.querySelector(sel);
      ['input','change','keyup'].forEach(e => inp.dispatchEvent(new Event(e,{bubbles:true})));
    }, searchSel);
    await page.waitForTimeout(2000);

    const cleared = await page.evaluate(() => {
      const pag = document.querySelector('.levcharity-pagination');
      return {
        pagVisible:   pag ? (window.getComputedStyle(pag).display!=='none' && pag.offsetHeight>0) : false,
        visibleCards: [...document.querySelectorAll('.team-campaign-participant-item')].filter(e=>e.offsetParent!==null).length,
      };
    });
    r.push(chk('[Search/Pagination] Step 5: Cards restored after clear', cleared.visibleCards>0, cleared.visibleCards+' cards back'));
    r.push(chk('[Search/Pagination] Step 5: Pagination restored after clear', cleared.pagVisible));

    const ss4 = await screenshot(page, 'Step 5: After clearing search — recovered');
    if (ss4) r.push({...ss4, name:'[Search/Pagination] Step 5: Recovered after clear', pass:cleared.visibleCards>0, detail:cleared.visibleCards+' cards, pagination: '+(cleared.pagVisible?'visible':'hidden')});

  } catch(e) {
    r.push(chk('[Search/Pagination] Test error', false, e.message.slice(0,100)));
  }
  return r;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN SITE RUNNER — dispatches to correct module suite based on site.type
// ─────────────────────────────────────────────────────────────────────────────
async function runSite(browser, site) {
  const start = Date.now();
  const result = {
    id: site.id, name: site.name, url: site.url, type: site.type,
    runAt: new Date().toISOString(),
    status: 'pass', modules: {}, majorFailures: [],
    summary: { total:0, passed:0, failed:0 },
    githubRun: {
      repo: 'neohanna17/qa-agent',
      runUrl: process.env.GITHUB_RUN_ID
        ? 'https://github.com/neohanna17/qa-agent/actions/runs/'+process.env.GITHUB_RUN_ID
        : 'https://github.com/neohanna17/qa-agent/actions',
      runId: process.env.GITHUB_RUN_ID || null,
    },
  };

  log(`\n${'═'.repeat(60)}`, 'section');
  log(`  ${site.name}  [${site.type}]  ${site.url}`, 'section');
  log(`${'═'.repeat(60)}`, 'section');

  let page;
  try {
    page = await mkPage(browser);

    // Load the main campaign/landing page
    const mainUrl = site.type === 'donationForm'
      ? site.url + site.config.donatePath
      : site.type === 'p2pCampaign'
      ? site.url + site.config.campaignPath
      : site.url + (site.config.campaignPath || '/');

    const resp = await page.goto(mainUrl, { waitUntil:'domcontentloaded', timeout:30000 });
    const httpStatus = resp?.status() ?? 0;
    if (httpStatus >= 400) {
      result.majorFailures.push('HTTP '+httpStatus+' — site not reachable');
      result.status = 'error';
      return result;
    }
    try { await page.waitForLoadState('networkidle', { timeout:10000 }); } catch {}
    await page.waitForTimeout(2000);

    // ── Run modules based on site type ──────────────────────────────────────

    let lastScreenshotUrl = '';  // Track URL to avoid duplicate screenshots
    let lastScreenshotB64 = '';  // Track content to avoid identical screenshots

    async function run(key, label, fn) {
      log(`\n  ── ${label} ──`, 'section');
      try {
        const checks = await fn();
        // Only screenshot if URL changed since last screenshot
        const currentUrl = page.url();
        const urlChanged = currentUrl !== lastScreenshotUrl;

        if (urlChanged) {
          const moduleSS = await screenshot(page, label);
          if (moduleSS) {
            const realChecks = checks.filter(c => !c.screenshot);
            const failed = realChecks.filter(c => !c.pass && !c.detail?.startsWith('SKIPPED:'));
            checks.push({
              ...moduleSS,
              name: '[Screenshot] '+label,
              label: label + (currentUrl ? ' — ' + currentUrl.replace('https://','').slice(0,40) : ''),
              pass: failed.length === 0,
              detail: failed.length === 0
                ? realChecks.length+' checks passed'
                : failed.length+' failed: '+failed.map(c=>c.name.replace(/^\[.*?\]\s*/,'')).slice(0,3).join(', ')
            });
            lastScreenshotUrl = currentUrl;
          }
        } else {
          // Same page — attach the last screenshot URL annotation to a check note only
          log(`    ⊘ Screenshot skipped — same page as ${key} (${currentUrl.replace('https://','').slice(0,40)})`, 'info');
        }

        result.modules[key] = checks;
        checks.forEach(c => {
          if (c.screenshot) return;
          const isSkip = c.detail?.startsWith('SKIPPED:');
          log(`    ${isSkip?'⊘':c.pass?'✓':'✗'} ${c.name} ${c.detail?'('+c.detail+')':''}`, isSkip?'info':c.pass?'pass':'fail');
        });
      } catch(e) {
        log(`    Module error: ${e.message}`, 'fail');
        result.modules[key] = [chk(label+': module crashed', false, e.message.slice(0,80))];
      }
    }

    // Header + Footer — all sites
    await run('header', 'Header', () => testHeader(page, site));
    await run('footer', 'Footer', () => testFooter(page, site));

    if (site.type === 'teamCampaign') {
      const campaignUrl = site.url + site.config.campaignPath;
      await goto(page, campaignUrl);

      await run('hero', 'Hero', () => testHero(page, site));

      // Fundraiser list (may be on a separate page)
      const listUrl = site.url + (site.config.fundraiserListPath || site.config.campaignPath);
      if (listUrl !== campaignUrl) await goto(page, listUrl);
      const { results: listResults, firstCardHref } = await (async () => {
        log(`\n  ── Fundraiser List ──`, 'section');
        const res = await testFundraiserList(page, site).catch(e => ({ results:[chk('FundraiserList: error',false,e.message)], firstCardHref:null }));
        result.modules['fundraiserList'] = res.results;
        res.results.forEach(c => { if (!c.screenshot) log(`    ${c.pass?'✓':'✗'} ${c.name} ${c.detail?'('+c.detail+')':''}`, c.pass?'pass':'fail'); });
        return res;
      })();

      // Fundraiser detail
      if (firstCardHref) {
        await run('fundraiserDetail', 'Fundraiser Detail', () => testFundraiserDetail(page, site, firstCardHref));
      }

      // Donations & About (only for sites that have it)
      if (site.config.hasDonationsAbout) {
        await run('donationsAbout', 'Donations & About', () => testDonationsAbout(page, site, campaignUrl));
      }

      // Signup form
      if (site.config.participatePath) {
        await run('signup', 'Signup / Participate Form', () => testSignup(page, site));
      }

      // Checkout
      const cartUrl = site.config.addToCartUrl;
      if (cartUrl && !site.config.cloudflareBlocked) {
        await run('checkout', 'Checkout Form', () => testCheckout(page, site, cartUrl));
      } else if (site.config.cloudflareBlocked) {
        result.modules['checkout'] = [skip('[Checkout] All checks', 'Cloudflare blocks CI IPs')];
      }

      // Extra site-specific tests
      if (site.config.extraTests?.includes('searchPagination')) {
        await run('searchPagination', 'Search / Pagination Bug Test', () => testChaiathonSearchPagination(page));
      }

    } else if (site.type === 'p2pCampaign') {
      await run('hero',       'Hero',              () => testHero(page, site));
      await run('p2pCampaign','P2P Campaign',       () => testP2PCampaign(page, site));
      if (site.config.addToCartUrl) {
        await run('checkout', 'Checkout Form', () => testCheckout(page, site, site.config.addToCartUrl));
      }

    } else if (site.type === 'donationForm') {
      await run('donationForm','Donation Form',     () => testDonationForm(page, site));
      if (site.config.checkoutViaCart && site.config.checkoutPath) {
        await run('checkout', 'Checkout Form', () => testCheckout(page, site, site.url+site.config.checkoutPath));
      }

    } else if (site.type === 'portal') {
      await run('portal', 'Portal Navigation', () => testPortal(page, site));
      if (site.config.donatePath) {
        await run('donationForm','Donation Form', () => testDonationForm(page, site));
      }
    }

    // Final screenshot
    try {
      const ss = await page.screenshot({ type:'jpeg', quality:50, fullPage:false });
      result.screenshot = ss.toString('base64');
    } catch {}

  } catch(e) {
    result.majorFailures.push('Fatal: '+e.message);
    result.status = 'error';
    log(`  FATAL: ${e.message}`, 'fail');
  } finally {
    if (page) await page.context().close().catch(()=>{});
  }

  // Tally
  let total=0, passed=0;
  Object.values(result.modules).forEach(checks => {
    checks.forEach(c => {
      if (c.screenshot) return;
      const isSkip = c.detail?.startsWith('SKIPPED:');
      if (!isSkip) { total++; if (c.pass) passed++; }
    });
  });
  result.summary = { total, passed, failed: total-passed };

  const failedChecks = Object.values(result.modules).flat()
    .filter(c => !c.pass && !c.screenshot && !c.detail?.startsWith('SKIPPED:'));
  // ANY failing check = fail status. List them all in majorFailures for transparency.
  if (failedChecks.length > 0) {
    result.status = 'fail';
    if (result.majorFailures.length === 0) {
      // Summarise which modules failed
      const failedModules = [...new Set(failedChecks.map(c => (c.name.match(/^\[([^\]]+)\]/) || ['',''])[1] || c.name.split(':')[0]).filter(Boolean))];
      result.majorFailures.push(failedChecks.length + ' check' + (failedChecks.length!==1?'s':'')+' failed: ' + failedModules.slice(0,5).join(', '));
    }
  }

  result.durationMs = Date.now() - start;
  log(`\n  ${result.status==='pass'?'✅':'❌'} ${site.name} — ${passed}/${total} checks — ${(result.durationMs/1000).toFixed(1)}s`, result.status==='pass'?'pass':'fail');
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  const date = new Date().toISOString().split('T')[0];
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  LevCharity Flow Tests — ${date}`);
  console.log(`${'═'.repeat(60)}\n`);

  let sitesToRun = SITES;
  if (SINGLE_SITE) sitesToRun = SITES.filter(s => s.id === SINGLE_SITE);
  if (SITE_TYPE)   sitesToRun = SITES.filter(s => s.type === SITE_TYPE);

  if (!sitesToRun.length) {
    console.error('No sites matched. SINGLE_SITE='+SINGLE_SITE+' SITE_TYPE='+SITE_TYPE);
    process.exit(1);
  }

  const browser = await chromium.launch({
    args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage',
          '--disable-blink-features=AutomationControlled','--window-size=1440,900'],
  });

  let passed=0, failed=0;
  const results = {};

  for (const site of sitesToRun) {
    const r = await runSite(browser, site);
    results[site.id] = r;
    if (r.status === 'pass') passed++;
    else { failed++; log(`\n  ❌ ${site.name}: ${r.majorFailures.join(' | ')}`, 'fail'); }

    await saveToFirebase(`flowResults/${date}/${site.id}`, r);
    await new Promise(res => setTimeout(res, 2000));
  }

  await browser.close();

  const summary = { date, total:sitesToRun.length, passed, failed, runAt:new Date().toISOString() };
  await saveToFirebase('flowLatest', { date, summary });
  await saveToFirebase(`flowSummary/${date}`, summary);

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  Done: ${passed} passed · ${failed} failed`);
  console.log(`  Firebase: flowResults/${date}/`);
  console.log(`${'═'.repeat(60)}\n`);

  process.exit(0);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
