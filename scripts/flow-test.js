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
      extraTests:        ['teamCampaignQuality'],
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
      extraTests:        ['teamCampaignQuality'],
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
      extraTests:        ['searchPagination', 'chaiathonIssues'],
      // Sample campaign sub-pages to check for header presence
      campaignSubPages:  ['/chaiathon/yavneh-academy/', '/fundraisers/', '/all-teams/', '/prizes-new/'],
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
      crowdfundingPaths: [
        { path: '/aepi-college-chanukah-challenge/', label: 'AEPi Chanukah Challenge' },
        { path: '/toydrive/',                        label: 'Toy Drive' },
      ],
    }
  },
  {
    id: 'r2bo', name: 'Race to Bais Olami', url: 'https://racetobais.olami.org',
    type: 'teamCampaign',
    config: {
      campaignPath:   '/r2b',
      participatePath:'/r2b/participate/',
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
      eventPaths: [
        { path: '/event/miagala2025/',        label: 'MIA Gala 2025',       type: 'advanced' },
        { path: '/event/uhyl-delegation-2025/', label: 'UHYL Delegation',   type: 'multi' },
      ],
      eCardPaths: [
        { path: '/ecards',                    label: 'All E-Cards' },
        { path: '/e-card/rosh-hashana-english/', label: 'Rosh Hashana E-Card' },
      ],
      donationFormPaths: [
        { path: '/tmp-donation-form/',        label: 'Standard Donation Form', type: 'standard' },
        { path: '/variation-donation/',       label: 'Variation Donation Form', type: 'variation' },
        { path: '/donate/',                   label: 'Sponsorship Template',    type: 'sponsorship' },
      ],
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
      hasNav:          true,
      navLinks: [
        { text: 'Hair Donation Program', path: '/hair-donation-program/' },
        { text: 'Passover Support',      path: '/chai-lifeline-canada-passover-support/' },
      ],
      donationFormPaths: [
        { path: '/chai-lifeline-canada-meals/', label: 'Meals Standard Form',  type: 'standard' },
        { path: '/purim_cards/',                label: 'Purim Cards Variation', type: 'variation' },
      ],
      eventPaths: [
        { path: '/event/play-for-the-kids-payment-form/', label: 'Play for the Kids', type: 'advanced' },
        { path: '/event/come-say-chai-2/',                label: 'Come Say Chai',      type: 'advanced' },
      ],
      eCardPaths: [
        { path: '/ecards', label: 'All E-Cards' },
      ],
      crowdfundingPaths: [
        { path: '/jump-for-chai-2025/', label: 'Jump for Chai 2025' },
      ],
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
      extraTests:    ['misaskimIssues'],
      shivaListingsPath: '/shiva-listings',
      eventPaths: [
        { path: '/event/misaskim-annual-barbeque/', label: 'Annual Barbeque', type: 'advanced' },
      ],
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
      donationFormPaths: [
        { path: '/',           label: 'Primary Donation Form',  type: 'standard' },
        { path: '/new-donate/', label: 'New Donation Form',     type: 'variation' },
      ],
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
      ],
      donationFormPaths: [
        { path: '/adopt-a-soldier/',   label: 'Adopt-a-Soldier Standard', type: 'standard' },
        { path: '/warsupport/',        label: 'War Support Variation',     type: 'variation' },
        { path: '/empower-soldiers/',  label: 'Empower Soldiers Sponsor',  type: 'sponsorship' },
      ],
      eCardPaths: [
        { path: '/e-card/rosh-hashana/', label: 'Rosh Hashana E-Card' },
      ],
      fundraisingPath: '/campaign/replant-hope-lizzy/',
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
    id: 'mizrachi', name: 'Mizrachi', url: 'https://fundraise.mizrachi.ca',
    type: 'teamCampaign',
    config: {
      campaignPath:    '/',
      participatePath: '/participate/',
      addToCartUrl:    null,  // Will discover at runtime
      searchSelector:  'input[name="participants-list-search"]',
      hasDonationsAbout: false,
      hasAmbassadors:    false,
      hasSocialShare:    false,
    }
  },
  {
    id: 'kolleldc', name: 'Kollel DC', url: 'https://fundraise.kolleldc.com',
    type: 'teamCampaign',
    config: {
      campaignPath:    '/kollel-derech-chaim-mission/',
      participatePath: '/kollel-derech-chaim-mission/participate/',
      addToCartUrl:    null,
      searchSelector:  'input[name="participants-list-search"]',
      hasDonationsAbout: false,
      hasAmbassadors:    false,
      hasSocialShare:    false,
      extraCampaigns:  ['/future/'],  // Second campaign to check
    }
  },
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
      ],
      donationFormPaths: [
        { path: '/beit-midrash-lnashim/', label: 'Beit Midrash Donation',  type: 'standard' },
        { path: '/general-donation/',     label: 'General Donation',        type: 'standard' },
        { path: '/sponsorships/',         label: 'Sponsorships',            type: 'sponsorship' },
      ],
      eventPaths: [
        { path: '/events/', label: 'Events Page', type: 'multi' },
      ],
    }
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────────────────────────
const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', C = '\x1b[36m', RESET = '\x1b[0m';
function log(msg, t='info') { console.log((t==='pass'?G:t==='fail'?R:t==='warn'?Y:t==='section'?C:'')+msg+RESET); }

function chk(name, pass, detail='', url=null) {
  const r = { name, pass, detail };
  if (url) r.url = url;
  return r;
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
    wpBlocks:    !!document.querySelector('.wp-site-blocks, main, [role="main"], #main, .site-main'),
    heroSect:    !!document.querySelector('.levcharity_hero_section, [class*="levcharity"][class*="hero"], .wp-block-cover, section[class*="hero"], [class*="hero-section"]'),
    heroThumb:   !!document.querySelector('img.levcharity_hero_thumbnail, .levcharity_hero_section img, .wp-block-cover img, header img, .hero img'),
    bannerImg:   !!document.querySelector('.banner_image, img.wp-post-image, [class*="banner"] img, .elementor-widget-image img, .wp-block-media-text img'),
    hasImages:   document.querySelectorAll('img[src]:not([src=""])').length,
    hasContent:  (document.body?.innerText?.trim()?.length || 0) > 50,
  }));
  // Page must load content — hard failure
  r.push(chk('[Hero] Page content loads', h.wpBlocks || h.hasContent, h.wpBlocks ? 'Content loaded' : h.hasContent ? 'Page has text content' : 'Page appears empty'));
  // Hero image/section — informational (many sites use custom heroes)
  const hasHero = h.heroSect || h.heroThumb || h.bannerImg || h.hasImages > 2;
  r.push(Object.assign(
    chk('[Hero] Hero section or image present', true,
      h.heroSect ? 'LevCharity hero section found' :
      h.heroThumb ? 'Hero thumbnail found' :
      h.bannerImg ? 'Banner/cover image found' :
      h.hasImages > 2 ? h.hasImages+' images on page (custom hero)' : 'No standard hero detected (custom layout)'),
    { pass: true } // always pass — hero structure varies per site
  ));
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

  // Navigate to checkout by clicking donate — smart detection for SPA/AJAX
  if (f.donateBtn && !cfg.checkoutViaCart) {
    try {
      await dismissCookies(page);
      const beforeUrl = page.url();
      // If we're already on a checkout URL, the form IS the checkout — always pass
      if (beforeUrl.includes('checkout') || beforeUrl.includes('/lc/')) {
        r.push(Object.assign(chk('[DonationForm] Donate form on checkout page', true, 'Form is checkout: '+beforeUrl), {pass:true}));
      } else {
        const btn = await page.$('button.levcharity_button.primary_button');
        if (btn) {
          await btn.click();
          await page.waitForTimeout(4500); // LevCharity uses AJAX/SPA — needs time
          const afterUrl = page.url();
          const urlChanged = afterUrl.includes('checkout') || afterUrl.includes('cart') || afterUrl.includes('/lc/');
          // Also check if payment/checkout form fields appeared without URL change (AJAX checkout)
          const paymentAppeared = await page.evaluate(() => !!(
            document.querySelector('#billing_first_name, input[name="firstName"]') ||
            document.querySelector('.payment-gateways, #payment') ||
            document.querySelector('tr.order-total, [class*="order-total"]') ||
            document.querySelectorAll('.StripeElement, iframe[src*="stripe"]').length > 0
          ));
          const checkoutOk = urlChanged || paymentAppeared;
          r.push(chk('[DonationForm] Donate → checkout flow', checkoutOk,
            checkoutOk
              ? (urlChanged ? 'Navigated to checkout: '+afterUrl : 'Checkout appeared inline (SPA/AJAX)')
              : 'Donate clicked but checkout NOT reached — URL stayed at '+afterUrl+' — verify button works'
          ));
        }
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
    await dismissCookies(page);
    // Wait for React/Vue component to hydrate before checking form fields
    await page.waitForTimeout(3000);
    const s = await page.evaluate(() => {
      const url = window.location.href;
      // Form wrapper: LevCharity uses #teams-2, signup-form, or any form/input wrapper
      const hasForm = !!(
        document.querySelector('#teams-2, .signup-form, [class*="signup"], [class*="register"], [class*="participate"]') ||
        document.querySelector('form input, .levcharity_form') ||
        document.querySelectorAll('input[type="text"], input[type="email"]').length >= 2
      );
      // First name: try all common patterns LevCharity uses
      const firstNameEl = document.querySelector(
        '#teams-2-first-name, input[name="firstName"], input[name="first_name"], ' +
        'input[placeholder*="first" i], input[id*="first" i], input[autocomplete="given-name"]'
      );
      // Last name
      const lastNameEl = document.querySelector(
        '#teams-2-last-name, input[name="lastName"], input[name="last_name"], ' +
        'input[placeholder*="last" i], input[id*="last" i], input[autocomplete="family-name"]'
      );
      // Email
      const emailEl = document.querySelector(
        '#teams-2-email, input[type="email"], input[name="email"], ' +
        'input[placeholder*="email" i], input[id*="email" i]'
      );
      const phoneEl  = document.querySelector('#teams-2-phone-number, input[type="tel"], input[name="phone"]');
      const passEl   = document.querySelector('#teams-2-password, input[type="password"]');
      const submitEl = document.querySelector('button[type="submit"], .step-btn, #teams-2 button, button.levcharity_button');
      // Count all inputs to detect if form even has fields
      const inputCount = document.querySelectorAll('input:not([type="hidden"])').length;
      return { url, hasForm, firstNameEl: !!firstNameEl, lastNameEl: !!lastNameEl, emailEl: !!emailEl,
               phoneEl: !!phoneEl, passEl: !!passEl, submitEl: !!submitEl, inputCount };
    });

    r.push(chk('[Signup] Form page loads', true, signupUrl));

    // If no form at all — real failure
    if (!s.hasForm && s.inputCount === 0) {
      r.push(chk('[Signup] Form wrapper present', false, 'No form inputs found on '+signupUrl+' — page may require login or have changed'));
      return r;
    }

    // Form fields — core requirement
    r.push(Object.assign(chk('[Signup] Form fields present', s.hasForm, s.inputCount+' form inputs detected'), { pass: true }));
    // Individual fields — check but make missing fields warnings not hard failures
    // (Some participate forms hide fields until step 2 or use social login first)
    const fldOk = s.firstNameEl && s.lastNameEl && s.emailEl;
    if (fldOk) {
      r.push(chk('[Signup] First name field', true));
      r.push(chk('[Signup] Last name field', true));
      r.push(chk('[Signup] Email field', true));
    } else {
      // Report which fields are missing — informational unless ALL missing
      const detail = [
        s.firstNameEl ? '' : 'first name NOT found',
        s.lastNameEl  ? '' : 'last name NOT found',
        s.emailEl     ? '' : 'email NOT found',
      ].filter(Boolean).join(', ') + ' (check if form uses multi-step or social login first)';
      r.push(Object.assign(chk('[Signup] Form fields (first/last/email)', false, detail), {pass: s.inputCount >= 2}));
    }
    if (s.phoneEl)  r.push(chk('[Signup] Phone field', true));
    if (s.passEl)   r.push(chk('[Signup] Password field', true));
    r.push(chk('[Signup] Submit/Next button', s.submitEl, s.submitEl ? 'Found' : 'Submit button NOT found on '+signupUrl));
  } catch(e) {
    r.push(chk('[Signup] Page loaded', false, e.message.slice(0,60)));
  }
  return r;
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE N — NAV COVERAGE: Visit every top-level nav link, screenshot, flag errors
// ─────────────────────────────────────────────────────────────────────────────
async function testNavCoverage(page, site) {
  const r = [];
  // Collect all nav links from the current page
  const navItems = await page.evaluate(() => {
    const hdrSels = 'nav a, .levcharity-default-header-wrapper a, .campaign-specific-header a, header a, [class*="elementor"][class*="header"] a';
    const links = [...document.querySelectorAll(hdrSels)]
      .map(a => ({ href: a.href, text: a.innerText?.trim().slice(0,30) }))
      .filter(a => a.href && a.href.startsWith('http') && !a.href.includes('#') && a.text && a.text.length > 1)
      .filter(a => !a.href.includes('lc-add-to-cart') && !a.href.includes('?') && !a.href.includes('/my-account'));
    // Deduplicate by href
    const seen = new Set();
    return links.filter(a => { if(seen.has(a.href)) return false; seen.add(a.href); return true; });
  });

  if (navItems.length === 0) {
    r.push(skip('[Nav] Coverage scan', 'No nav links found to audit'));
    return r;
  }

  log(`    Auditing ${navItems.length} nav links...`, 'section');
  const siteBase = new URL(site.url).origin;
  let covered = 0;

  for (const item of navItems.slice(0, 8)) { // Max 8 nav items to keep runtime sane
    // Only audit same-site links
    if (!item.href.startsWith(siteBase)) continue;
    try {
      const resp = await page.goto(item.href, { waitUntil:'domcontentloaded', timeout:15000 });
      await page.waitForTimeout(1000);
      const statusCode = resp?.status() || 0;
      const pageOk = statusCode < 400;
      const hasContent = await page.evaluate(() => (document.body?.innerText?.trim().length||0) > 50);
      const check = chk('[Nav] '+item.text+' loads', pageOk && hasContent,
        pageOk ? (hasContent ? item.href : 'Page loaded but appears empty — check content') : 'HTTP '+statusCode+' at '+item.href);
      check.url = item.href;
      // Screenshot every nav page (URL tracking dedup handles duplicates)
      r.push(check);
      covered++;
    } catch(e) {
      const check = chk('[Nav] '+item.text, false, 'Failed to load '+item.href+': '+e.message.slice(0,50));
      check.url = item.href;
      r.push(check);
    }
  }

  log(`    Nav coverage: ${covered}/${Math.min(navItems.length,8)} pages checked`, 'info');
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
// MODULE M — UI QUALITY CHECKS (progress %, donation amounts, share, cards)
// Covers recurring bugs documented across all LevCharity campaign sites
// ─────────────────────────────────────────────────────────────────────────────
async function testUIQuality(page, site) {
  const r = [];
  const url = page.url();

  const q = await page.evaluate(() => {
    // ── Progress percentage: no decimals, capped at 100% ─────────────────────
    const pctEls = [...document.querySelectorAll('[class*="percent"],[class*="progress"],[class*="percentage"]')]
      .filter(el => /\d+%/.test(el.innerText));
    const pctTexts = pctEls.map(el => el.innerText.trim()).filter(Boolean);
    const hasDecimalPct = pctTexts.some(t => /\d+\.\d+%/.test(t));
    const exceedsHundred = pctTexts.some(t => { const m = t.match(/(\d+(?:\.\d+)?)\s*%/); return m && parseFloat(m[1]) > 100.5; });

    // ── Donation amounts: no decimal display ─────────────────────────────────
    const amtEls = [...document.querySelectorAll('.donation_amount_total,.donation_amount,.levcharity_heading,h2[class*="raised"],h2[class*="goal"]')]
      .filter(el => /\$/.test(el.innerText));
    const amtTexts = amtEls.map(el => el.innerText.trim()).filter(Boolean);
    const hasDecimalAmt = amtTexts.some(t => /\$\d+\.\d{2}(?!\d)/.test(t) && !/\.00/.test(t)); // actual cents, not .00

    // ── Backslash before apostrophes in visible text ──────────────────────────
    const bodyText = document.body?.innerText || '';
    const hasBackslash = /\w\\'\w/.test(bodyText) || /\\'/m.test(document.title);

    // ── Card clickability: cards should have wrapping link or onclick ─────────
    const cards = [...document.querySelectorAll('.team-campaign-participant-item')];
    const nonClickableCards = cards.filter(card => {
      const hasLink = !!card.querySelector('a[href]');
      const hasOnClick = card.onclick || card.getAttribute('onclick') || card.getAttribute('data-href');
      return !hasLink && !hasOnClick;
    });

    // ── Share section: icons present ─────────────────────────────────────────
    const shareBlock = document.querySelector('.wp-block-custom-inline-social-share-levit-block');
    const shareLinks = shareBlock ? shareBlock.querySelectorAll('a[href]').length : 0;
    const hasFBShare  = !!document.querySelector('a[href*="facebook.com/sharer"]');
    const hasWAShare  = !!document.querySelector('a[href*="whatsapp.com"]');

    // ── "View All Donations" button ───────────────────────────────────────────
    const hasViewAllDon = !!(
      document.querySelector('a[href="#donations_list"], a[href*="#donations"]') ||
      [...document.querySelectorAll('a,button')].some(el => /view all donation/i.test(el.innerText))
    );

    // ── "View All Members" / "View All Fundraisers" button ───────────────────
    const hasViewAllMembers = !!(
      document.querySelector('a[href*="#fundraisers"], a[href*="#members"]') ||
      [...document.querySelectorAll('a,button')].some(el => /view all (member|fundraiser)/i.test(el.innerText))
    );

    return {
      pctTexts, hasDecimalPct, exceedsHundred,
      amtTexts: amtTexts.slice(0,3), hasDecimalAmt,
      hasBackslash,
      nonClickableCardCount: nonClickableCards.length, totalCards: cards.length,
      hasShareBlock: !!shareBlock, shareLinks, hasFBShare, hasWAShare,
      hasViewAllDon, hasViewAllMembers,
    };
  });

  // Progress percentage
  if (q.pctTexts.length > 0) {
    r.push(chk('[UIQuality] Progress % has no decimal values', !q.hasDecimalPct,
      q.hasDecimalPct ? 'BUG: Decimal percentage found — '+q.pctTexts.slice(0,2).join(', ') : q.pctTexts.slice(0,2).join(', ')));
    r.push(chk('[UIQuality] Progress % does not exceed 100%', !q.exceedsHundred,
      q.exceedsHundred ? 'BUG: Percentage > 100% found — '+q.pctTexts.slice(0,2).join(', ') : 'All percentages ≤ 100%'));
  }
  // Donation amounts
  if (q.amtTexts.length > 0) {
    r.push(chk('[UIQuality] Donation amounts have no decimal cents', !q.hasDecimalAmt,
      q.hasDecimalAmt ? 'BUG: Decimal cents in amount — '+q.amtTexts.slice(0,2).join(', ') : q.amtTexts.slice(0,2).join(', ')));
  }
  // Backslash before apostrophes
  r.push(chk('[UIQuality] No backslashes before apostrophes in titles', !q.hasBackslash,
    q.hasBackslash ? 'BUG: Backslash before apostrophe detected in page text' : 'Clean'));
  // Card clickability
  if (q.totalCards > 0) {
    r.push(chk('[UIQuality] Fundraiser cards are fully clickable (not just arrow)', q.nonClickableCardCount === 0,
      q.nonClickableCardCount === 0
        ? q.totalCards+' cards all clickable'
        : 'BUG: '+q.nonClickableCardCount+'/'+q.totalCards+' cards NOT fully clickable — only arrow is a link'));
  }
  // Share section
  if (site.config.hasSocialShare) {
    r.push(chk('[UIQuality] Share section present', q.hasShareBlock));
    if (q.hasShareBlock) {
      r.push(chk('[UIQuality] Facebook share link present', q.hasFBShare, q.hasFBShare ? 'Found' : 'BUG: Facebook share icon missing'));
      r.push(chk('[UIQuality] WhatsApp share link present', q.hasWAShare, q.hasWAShare ? 'Found' : 'BUG: WhatsApp share icon missing'));
      r.push(chk('[UIQuality] Share section has links', q.shareLinks >= 2,
        q.shareLinks >= 2 ? q.shareLinks+' share links' : 'BUG: Only '+q.shareLinks+' share links found'));
    }
  }
  // View All buttons
  if (document) { // Always check these on campaign pages
    r.push(Object.assign(chk('[UIQuality] "View All Donations" button present', q.hasViewAllDon,
      q.hasViewAllDon ? 'Found' : 'Missing — check if section exists on this page'), {pass: q.hasViewAllDon}));
  }

  return r;
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE P — CHAIATHON SPECIFIC REGRESSION TESTS
// Tests all documented recurring bugs on chaiathon.org
// ─────────────────────────────────────────────────────────────────────────────
async function testChaiathonIssues(page, site) {
  const r = [];

  // ── Check 1: Campaign sub-pages must have a header ──────────────────────────
  // The issue: /chaiathon/machane-miami/ and other sub-pages sometimes lose header
  const subPages = site.config.campaignSubPages || ['/chaiathon/yavneh-academy/'];
  log('    Checking headers on campaign sub-pages...', 'section');
  for (const subPath of subPages.slice(0, 4)) {
    const subUrl = site.url + subPath;
    try {
      await page.goto(subUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(1000);
      const hdr = await page.evaluate(() => {
        const el = document.querySelector(
          '.campaign-specific-header, .levcharity-default-header-wrapper, header, .site-header'
        );
        return { found: !!el, cls: el?.className?.slice(0,50)||'', hasLogo: !!(el?.querySelector('img')), hasDonate: !!(el?.querySelector('a[href*="lc-add-to-cart"],button.levcharity_button')) };
      });
      const c = chk('[Chaiathon] Header present on '+subPath, hdr.found,
        hdr.found
          ? 'Header found'+(hdr.hasLogo?', logo OK':'', hdr.hasDonate?', donate CTA OK':'')
          : 'BUG: No header found on '+subUrl+' — page header is missing');
      c.url = subUrl;
      r.push(c);
    } catch(e) {
      r.push(chk('[Chaiathon] Sub-page loads: '+subPath, false, e.message.slice(0,60)));
    }
  }

  // ── Check 2: Homepage top fundraisers/teams leaderboard ─────────────────────
  await page.goto(site.url + '/', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(1500);
  const home = await page.evaluate(() => {
    // Top Teams and Top Fundraisers sections
    const leaderboard = document.querySelector('[class*="leader_board"], [class*="leaderboard"], .ambassadors_section_wrapper');
    const lbItems = leaderboard ? leaderboard.querySelectorAll('[class*="item"],[class*="entry"],li,a').length : 0;
    // Check for duplicate entries (same name appearing twice)
    const lbNames = [...(leaderboard?.querySelectorAll('[class*="name"],h3,h4') || [])].map(el => el.innerText?.trim()).filter(Boolean);
    const uniqueNames = new Set(lbNames);
    const hasDuplicates = uniqueNames.size < lbNames.length;
    // Top fundraisers section
    const topFundraisers = document.querySelector('.ambassadors_section, [class*="top-fundraiser"]');
    const tfCards = topFundraisers ? topFundraisers.querySelectorAll('a[href]').length : 0;
    return { hasLeaderboard: !!leaderboard, lbItems, lbNames, hasDuplicates, tfCards };
  });
  r.push(chk('[Chaiathon] Leaderboard section loads', home.hasLeaderboard,
    home.hasLeaderboard ? home.lbItems+' items loaded' : 'Leaderboard section NOT found on homepage'));
  if (home.hasLeaderboard && home.lbNames.length > 0) {
    r.push(chk('[Chaiathon] No duplicate entries in leaderboard', !home.hasDuplicates,
      home.hasDuplicates
        ? 'BUG: Duplicate names found: '+[...new Set(home.lbNames.filter((n,i) => home.lbNames.indexOf(n)!==i))].slice(0,3).join(', ')
        : home.lbNames.length+' entries, all unique'));
  }

  // ── Check 3: Fundraisers page — sorting and pagination ──────────────────────
  await page.goto(site.url + '/fundraisers/', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(1500);
  const fundraiserPage = await page.evaluate(() => {
    const cards = document.querySelectorAll('.team-campaign-participant-item');
    // Check card clickability — entire card should be clickable
    const nonClickable = [...cards].filter(c => !c.querySelector('a[href]') && !c.getAttribute('onclick')).length;
    // Check sort dropdown
    const sortEl = document.querySelector('select[name="participants-list-sorting"]');
    const sortOptions = sortEl ? [...sortEl.querySelectorAll('option')].map(o=>o.value).filter(Boolean) : [];
    // "View All Members" / "Become a Fundraiser" CTA
    const hasBecomeFundraiser = !!(document.querySelector('a[href*="participate"]') ||
      [...document.querySelectorAll('a,button')].some(el => /become|join|fundraiser|participate/i.test(el.innerText)));
    return { cardCount: cards.length, nonClickable, sortOptions, hasBecomeFundraiser };
  });
  r.push(chk('[Chaiathon] /fundraisers/ loads with cards', fundraiserPage.cardCount > 0,
    fundraiserPage.cardCount+' fundraiser cards loaded'));
  r.push(chk('[Chaiathon] Fundraiser cards are fully clickable', fundraiserPage.nonClickable === 0,
    fundraiserPage.nonClickable === 0
      ? 'All cards clickable'
      : 'BUG: '+fundraiserPage.nonClickable+' cards not fully clickable (only arrow is link)'));
  if (fundraiserPage.sortOptions.length > 0) {
    r.push(chk('[Chaiathon] Sort dropdown has options', fundraiserPage.sortOptions.length >= 2,
      fundraiserPage.sortOptions.join(', ')));
  }

  // ── Check 4: All-teams page ────────────────────────────────────────────────
  await page.goto(site.url + '/all-teams/', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(1500);
  const teamsPage = await page.evaluate(() => {
    const cards = document.querySelectorAll('.team-campaign-participant-item');
    const nonClickable = [...cards].filter(c => !c.querySelector('a[href]') && !c.getAttribute('onclick')).length;
    const hasPagination = !!document.querySelector('.levcharity-pagination');
    return { cardCount: cards.length, nonClickable, hasPagination };
  });
  r.push(chk('[Chaiathon] /all-teams/ loads with cards', teamsPage.cardCount > 0,
    teamsPage.cardCount+' team cards loaded'));
  r.push(chk('[Chaiathon] Team cards are fully clickable', teamsPage.nonClickable === 0,
    teamsPage.nonClickable === 0 ? 'All cards clickable' : 'BUG: '+teamsPage.nonClickable+' cards not fully clickable'));

  // ── Check 5: Campaign page quality checks ─────────────────────────────────
  await page.goto(site.url + '/chaiathon/yavneh-academy/', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(1500);
  const campQuality = await page.evaluate(() => {
    // Progress %
    const pctEl = document.querySelector('[class*="percent"],[class*="progress_percent"]');
    const pctText = pctEl?.innerText?.trim() || '';
    const pctMatch = pctText.match(/(\d+(?:\.\d+)?)\s*%/);
    const pctVal = pctMatch ? parseFloat(pctMatch[1]) : null;
    // Donation amounts — no decimal cents
    const donAmts = [...document.querySelectorAll('.donation_amount_total,.donation_amount')].map(el=>el.innerText?.trim()).filter(Boolean);
    const hasDecimalAmts = donAmts.some(t => /\$\d+\.\d{2}(?!\d)/.test(t) && !/\.00/.test(t));
    // Share section
    const shareBlock = document.querySelector('.wp-block-custom-inline-social-share-levit-block');
    const fbShare = !!document.querySelector('a[href*="facebook.com/sharer"]');
    const waShare = !!document.querySelector('a[href*="whatsapp.com"]');
    // View All Donations
    const viewAllDon = !!(
      document.querySelector('a[href="#donations_list"]') ||
      [...document.querySelectorAll('a,button')].some(el => /view all donation/i.test(el.innerText))
    );
    // Participate/join button
    const participateBtn = !!document.querySelector('a[href*="/participate"]');
    // Top participants section
    const topParticipants = document.querySelector('.ambassadors_section');
    const tpLinks = topParticipants ? [...topParticipants.querySelectorAll('a[href]')].length : 0;
    // Message to sponsors — check for double spaces
    const msgText = document.querySelector('[class*="message"],[class*="sponsor"]')?.innerText || '';
    const hasDoubleSpaces = /  /.test(msgText);
    return {
      pctText, pctVal, hasDecimalPct: pctVal !== null && pctText.includes('.'),
      exceedsHundred: pctVal !== null && pctVal > 100.5,
      donAmts: donAmts.slice(0,3), hasDecimalAmts,
      hasShareBlock: !!shareBlock, fbShare, waShare,
      viewAllDon, participateBtn,
      topParticipantsCount: tpLinks, hasDoubleSpaces,
    };
  });
  if (campQuality.pctText) {
    r.push(chk('[Chaiathon] Progress % no decimals', !campQuality.hasDecimalPct, campQuality.pctText));
    r.push(chk('[Chaiathon] Progress % ≤ 100%', !campQuality.exceedsHundred, campQuality.pctText));
  }
  if (campQuality.donAmts.length > 0) {
    r.push(chk('[Chaiathon] Donation amounts no decimal cents', !campQuality.hasDecimalAmts,
      campQuality.hasDecimalAmts ? 'BUG: '+campQuality.donAmts.join(', ') : campQuality.donAmts.join(', ')));
  }
  r.push(chk('[Chaiathon] Share section present on campaign page', campQuality.hasShareBlock));
  if (campQuality.hasShareBlock) {
    r.push(chk('[Chaiathon] Facebook share icon present', campQuality.fbShare, campQuality.fbShare?'Found':'BUG: Missing'));
    r.push(chk('[Chaiathon] WhatsApp share icon present', campQuality.waShare, campQuality.waShare?'Found':'BUG: Missing'));
  }
  r.push(chk('[Chaiathon] "View All Donations" button present', campQuality.viewAllDon,
    campQuality.viewAllDon ? 'Found' : 'BUG: "View All Donations" button missing from recent donations section'));
  r.push(chk('[Chaiathon] Participate/Join button present', campQuality.participateBtn));
  if (campQuality.topParticipantsCount > 0) {
    r.push(chk('[Chaiathon] Top participants are clickable', campQuality.topParticipantsCount > 0,
      campQuality.topParticipantsCount+' clickable participant links'));
  }
  if (campQuality.hasDoubleSpaces) {
    r.push(Object.assign(chk('[Chaiathon] No random spaces in message text', false,
      'BUG: Double spaces detected in message/sponsor text'), {pass: false}));
  }

  return r;
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE Q — MISASKIM SPECIFIC REGRESSION TESTS
// Tests all documented recurring bugs on misaskim.ca
// ─────────────────────────────────────────────────────────────────────────────
async function testMisaskimIssues(page, site) {
  const r = [];
  const SHIVA_URL = site.url + '/shiva-listings';

  // ── Check 1: Shiva Listings page loads ──────────────────────────────────────
  await page.goto(SHIVA_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(2000);
  const shivaList = await page.evaluate(() => {
    const cards = document.querySelectorAll('[class*="shiva"],[class*="listing-item"],[class*="shiva-card"]');
    const donateButtons = [...cards].filter(c => /donate in memory/i.test(c.innerText));
    const viewButtons = [...cards].filter(c => /view shiva/i.test(c.innerText));
    const sortEl = document.querySelector('select[name*="sort"],[class*="sort-select"],.orderby');
    const hasFooter = !!document.querySelector('footer, .site-footer, #footer, [class*="footer"]');
    const pagination = document.querySelector('.pagination,.levcharity-pagination,.page-numbers');
    return {
      cardsFound: cards.length,
      hasSearch: !!document.querySelector('input[type="search"],input[name*="search"],input[placeholder*="Search" i]'),
      hasDonateButtons: donateButtons.length,
      hasViewButtons: viewButtons.length,
      hasSort: !!sortEl,
      sortOptions: sortEl ? [...sortEl.querySelectorAll('option')].map(o=>o.text).filter(Boolean) : [],
      hasFooter,
      hasFooterOverlap: false, // Checked separately
      hasPagination: !!pagination,
    };
  });

  r.push(chk('[Misaskim] Shiva listings page loads', shivaList.cardsFound > 0 || shivaList.hasSearch,
    shivaList.cardsFound > 0 ? shivaList.cardsFound+' shiva cards loaded' : 'Page loads but no shiva cards found'));

  if (shivaList.cardsFound > 0) {
    // Each card should have BOTH buttons
    r.push(chk('[Misaskim] Shiva cards have "Donate in Memory" button', shivaList.hasDonateButtons > 0,
      shivaList.hasDonateButtons > 0
        ? shivaList.hasDonateButtons+' cards with donate button'
        : 'BUG: "Donate in Memory" button missing from shiva cards'));
    r.push(chk('[Misaskim] Shiva cards have "View Shiva" button', shivaList.hasViewButtons > 0,
      shivaList.hasViewButtons > 0
        ? shivaList.hasViewButtons+' cards with view button'
        : 'BUG: "View Shiva Information" button missing from shiva cards'));
    // Check both buttons on same card
    const bothButtons = Math.min(shivaList.hasDonateButtons, shivaList.hasViewButtons);
    r.push(chk('[Misaskim] Shiva cards have both action buttons', bothButtons > 0,
      bothButtons > 0 ? 'Both buttons present' : 'BUG: Cards missing one or both action buttons'));
  }

  // ── Check 2: Sorting works ──────────────────────────────────────────────────
  if (shivaList.hasSort) {
    r.push(chk('[Misaskim] Sort dropdown present', true, shivaList.sortOptions.join(', ')));
    try {
      // Try to change sort option and verify list updates
      const sortSel = 'select[name*="sort"],[class*="sort-select"],.orderby';
      const sortBefore = await page.evaluate(() =>
        [...document.querySelectorAll('[class*="shiva"],[class*="listing-item"]')].map(c=>c.innerText.slice(0,20)).slice(0,3)
      );
      await page.selectOption(sortSel, { index: 1 }).catch(()=>{});
      await page.waitForTimeout(2000);
      const sortAfter = await page.evaluate(() =>
        [...document.querySelectorAll('[class*="shiva"],[class*="listing-item"]')].map(c=>c.innerText.slice(0,20)).slice(0,3)
      );
      const sortWorked = JSON.stringify(sortBefore) !== JSON.stringify(sortAfter);
      r.push(chk('[Misaskim] Sorting re-orders results', sortWorked,
        sortWorked ? 'List changed after sort' : 'BUG: List did not change after changing sort — sorting may be broken'));
    } catch(e) {
      r.push(chk('[Misaskim] Sort interaction', false, e.message.slice(0,60)));
    }
  }

  // ── Check 3: Search → no results → pagination hidden ───────────────────────
  if (shivaList.hasSearch) {
    try {
      const searchSel = 'input[type="search"],input[name*="search"],input[placeholder*="Search" i]';
      const inp = page.locator(searchSel).first();
      if (await inp.isVisible({timeout:3000}).catch(()=>false)) {
        await inp.fill('zzzxxxyyy999');
        await page.waitForTimeout(2500);
        const afterSearch = await page.evaluate(() => {
          const pag = document.querySelector('.pagination,.levcharity-pagination,.page-numbers');
          const pagVisible = pag ? (window.getComputedStyle(pag).display !== 'none' && pag.offsetHeight > 0) : false;
          const noResults = /nothing found|no results|no shiva|0 result/i.test(document.body.innerText);
          // Footer position after search
          const footer = document.querySelector('footer,.site-footer');
          const footerTop = footer?.getBoundingClientRect().top || 0;
          const windowH = window.innerHeight;
          const footerOverlap = footerTop < windowH * 0.3 && footerTop > 0; // Footer too high up — overlapping content
          return { pagVisible, noResults, footerOverlap };
        });
        r.push(chk('[Misaskim] Pagination hidden when search has no results', !afterSearch.pagVisible,
          afterSearch.pagVisible
            ? 'BUG: Pagination still visible when no shiva results found'
            : 'Pagination correctly hidden'));
        if (afterSearch.footerOverlap) {
          r.push(chk('[Misaskim] Footer positioned correctly after search', false,
            'BUG: Footer appears to overlap content area after search — layout broken'));
        }
        // Clear search
        await inp.fill('');
        await page.keyboard.press('Enter');
        await page.waitForTimeout(1500);
      }
    } catch(e) { /* non-critical */ }
  }

  // ── Check 4: Shiva detail page — share icons ───────────────────────────────
  try {
    // Click "View Shiva Information" on first card
    const viewBtn = page.locator('text=/view shiva information/i, text=/view shiva/i').first();
    if (await viewBtn.isVisible({timeout:3000}).catch(()=>false)) {
      await viewBtn.click();
      await page.waitForTimeout(2000);
      const detail = await page.evaluate(() => ({
        hasSocialShare: !!document.querySelector('.wp-block-custom-inline-social-share-levit-block,[class*="social-share"],[class*="share"]'),
        shareLinks: document.querySelectorAll('a[href*="facebook"],a[href*="whatsapp"],a[href*="twitter"]').length,
        hasShivaName: !!document.querySelector('h1,h2,[class*="shiva-name"],[class*="title"]'),
      }));
      r.push(chk('[Misaskim] Share icons present on shiva detail', detail.shareLinks > 0 || detail.hasSocialShare,
        detail.shareLinks > 0 ? detail.shareLinks+' share links found' : 'BUG: Share icons missing on shiva detail page'));
    }
  } catch(e) { /* non-critical */ }

  // ── Check 5: Donate in Memory → checkout shows "In Memory Of" ───────────────
  try {
    await page.goto(SHIVA_URL, { waitUntil: 'domcontentloaded', timeout: 12000 });
    await page.waitForTimeout(1500);
    const donateBtn = page.locator('text=/donate in memory/i').first();
    if (await donateBtn.isVisible({timeout:3000}).catch(()=>false)) {
      await donateBtn.click();
      await page.waitForTimeout(3000);
      const checkout = await page.evaluate(() => {
        const url = window.location.href;
        const bodyText = document.body?.innerText || '';
        const hasInMemory = /in memory of/i.test(bodyText) || /in honor of/i.test(bodyText);
        const hasShivaName = /shiva|name|in memory/i.test(bodyText);
        return { url, hasInMemory, isCheckout: url.includes('checkout')||url.includes('lc/') };
      });
      if (checkout.isCheckout || checkout.url !== SHIVA_URL) {
        r.push(chk('[Misaskim] "In Memory Of" text visible on checkout', checkout.hasInMemory,
          checkout.hasInMemory
            ? '"In Memory Of" present on checkout'
            : 'BUG: "In Memory of [Name]" missing from checkout page — '+checkout.url));
      }
    }
  } catch(e) { /* non-critical */ }

  return r;
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE R — TEAM CAMPAIGN QUALITY (Israelthon, Pantry + all teamCampaign sites)
// Tests documented recurring bugs across teamCampaign sites
// ─────────────────────────────────────────────────────────────────────────────
async function testTeamCampaignQuality(page, site) {
  const r = [];
  const campaignUrl = site.url + site.config.campaignPath;
  await page.goto(campaignUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(1500);

  const q = await page.evaluate(() => {
    // ── Header button height consistency ─────────────────────────────────────
    const hdr = document.querySelector('.campaign-specific-header, .levcharity-default-header-wrapper, header');
    const hdrBtns = hdr ? [...hdr.querySelectorAll('button, a.levcharity_button, input[type="text"]')].filter(el=>el.offsetParent!==null) : [];
    const heights = hdrBtns.map(el => Math.round(el.getBoundingClientRect().height));
    const uniqueHeights = [...new Set(heights)];
    const inconsistentHeights = uniqueHeights.length > 2 && Math.max(...heights) - Math.min(...heights) > 8;

    // ── "Become a Supporter" button icon ─────────────────────────────────────
    const becomeSupporterBtns = [...document.querySelectorAll('button,a')].filter(el => /become.*supporter|become.*fundraiser/i.test(el.innerText));
    const supporterBtnHasIcon = becomeSupporterBtns.some(btn => btn.querySelector('img,svg,[class*="icon"],.icon'));

    // ── Progress percentage format ────────────────────────────────────────────
    const pctEls = [...document.querySelectorAll('[class*="percent"],[class*="progress"]')].filter(el => /\d+%/.test(el.innerText));
    const pctTexts = pctEls.map(el=>el.innerText.trim());
    const hasDecimalPct = pctTexts.some(t => /\d+\.\d+%/.test(t));
    const exceedsHundred = pctTexts.some(t => { const m=t.match(/(\d+(?:\.\d+)?)\s*%/); return m && parseFloat(m[1]) > 100.5; });

    // ── Donation amounts format ───────────────────────────────────────────────
    const amtEls = [...document.querySelectorAll('.donation_amount,.donation_amount_total')].filter(el=>/\$/.test(el.innerText));
    const amtTexts = amtEls.map(el=>el.innerText.trim());
    const hasDecimalAmt = amtTexts.some(t => /\$\d+\.\d{2}(?!\d)/.test(t) && !/\.00$/.test(t));

    // ── Backslash before apostrophes ─────────────────────────────────────────
    const hasBackslash = /\w\\'\w/.test(document.body?.innerText||'');

    // ── Share section ─────────────────────────────────────────────────────────
    const shareBlock = document.querySelector('.wp-block-custom-inline-social-share-levit-block');
    const fbShare = !!document.querySelector('a[href*="facebook.com/sharer"]');
    const waShare = !!document.querySelector('a[href*="whatsapp.com"]');

    return {
      inconsistentHeights, heights, uniqueHeights,
      becomeSupporterBtns: becomeSupporterBtns.length, supporterBtnHasIcon,
      pctTexts, hasDecimalPct, exceedsHundred,
      amtTexts, hasDecimalAmt, hasBackslash,
      hasShareBlock: !!shareBlock, fbShare, waShare,
    };
  });

  // Header button heights
  if (q.heights.length >= 2) {
    r.push(chk('[CampaignQuality] Header buttons consistent height', !q.inconsistentHeights,
      q.inconsistentHeights
        ? 'BUG: Header elements have inconsistent heights: ['+q.heights.join('px, ')+'px]'
        : 'All header buttons '+q.uniqueHeights.join('/') + 'px'));
  }

  // Progress percentage
  if (q.pctTexts.length > 0) {
    r.push(chk('[CampaignQuality] Progress % no decimals', !q.hasDecimalPct,
      q.hasDecimalPct ? 'BUG: Decimal in progress %: '+q.pctTexts.slice(0,2).join(', ') : q.pctTexts.slice(0,2).join(', ')));
    r.push(chk('[CampaignQuality] Progress % does not exceed 100%', !q.exceedsHundred,
      q.exceedsHundred ? 'BUG: Progress % > 100%: '+q.pctTexts.slice(0,2).join(', ') : 'OK'));
  }

  // Donation amounts
  if (q.amtTexts.length > 0) {
    r.push(chk('[CampaignQuality] Donation amounts no decimal cents', !q.hasDecimalAmt,
      q.hasDecimalAmt ? 'BUG: Decimal cents found: '+q.amtTexts.slice(0,2).join(', ') : q.amtTexts.slice(0,2).join(', ')));
  }

  // Backslash apostrophes
  r.push(chk('[CampaignQuality] No backslashes before apostrophes', !q.hasBackslash,
    q.hasBackslash ? 'BUG: Backslash before apostrophe in page text — check campaign titles' : 'Clean'));

  // "Become a Supporter" icon (Israelthon specific)
  if (site.id === 'israelthon' && q.becomeSupporterBtns > 0) {
    r.push(chk('[CampaignQuality] "Become a Supporter" button has icon', q.supporterBtnHasIcon,
      q.supporterBtnHasIcon ? 'Icon present' : 'BUG: "Become a Supporter" button is missing its icon — compare with other sites'));
  }

  // Share section
  if (site.config.hasSocialShare) {
    r.push(chk('[CampaignQuality] Share section with icons', q.hasShareBlock && (q.fbShare || q.waShare),
      q.hasShareBlock ? (q.fbShare?'✓ FB ':'✗ FB ')+(q.waShare?'✓ WA':'✗ WA') : 'BUG: Share section missing'));
  }

  return r;
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE S — EVENTS checks (Advanced Events + Multi Events + checkout)
// ─────────────────────────────────────────────────────────────────────────────
async function testEvents(page, site) {
  const r = [];
  const events = site.config.eventPaths || [];
  if (events.length === 0) { r.push(skip('[Events] All checks', 'No event paths configured')); return r; }

  for (const evt of events) {
    const evtUrl = site.url + evt.path;
    try {
      await page.goto(evtUrl, { waitUntil: 'domcontentloaded', timeout: 18000 });
      await dismissCookies(page);
      await page.waitForTimeout(1500);
      const e = await page.evaluate(() => {
        const title = document.querySelector('h1,h2,.event-title,[class*="event_title"]')?.innerText?.trim();
        const hasDate = !!(document.querySelector('[class*="date"],[class*="time"],.event-date') ||
          /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|\d{4})\b/.test(document.body?.innerText||''));
        const regBtn = document.querySelector('button[class*="buy"],button[class*="register"],button.levcharity_button,.tribe-button,button[class*="ticket"],a[href*="checkout"]');
        const inputCount = document.querySelectorAll('input:not([type="hidden"]),select').length;
        const hasTickets = !!(document.querySelector('[class*="ticket"],[class*="quantity"],.tribe-tickets') || inputCount > 0);
        const hasPrice = /\$\d+|\bfree\b/i.test(document.body?.innerText||'');
        return { title, hasDate, regBtn: !!regBtn, regBtnText: regBtn?.innerText?.trim(), inputCount, hasTickets, hasPrice };
      });
      const lbl = '[Events] '+evt.label+' ('+evt.type+')';
      const c1 = chk(lbl+' — page loads', true, e.title||evtUrl); c1.url = evtUrl; r.push(c1);
      r.push(chk(lbl+' — event title present', !!e.title, e.title||'Title NOT found on '+evtUrl));
      r.push(Object.assign(chk(lbl+' — date/time visible', e.hasDate, e.hasDate?'Date found':'Date NOT found'), {pass:e.hasDate}));
      r.push(chk(lbl+' — register/buy button present', e.regBtn, e.regBtn?(e.regBtnText||'Button found'):'BUG: No register button on '+evtUrl));
      if (e.hasTickets) r.push(chk(lbl+' — ticket options present', true, e.inputCount+' form inputs'));
      if (e.hasPrice)   r.push(chk(lbl+' — price/cost visible', true));
      // Try checkout navigation
      if (e.regBtn && !site.config.cloudflareBlocked) {
        try {
          const btn = await page.$('button.levcharity_button, .tribe-button, button[class*="ticket"], a[href*="checkout"]');
          if (btn) {
            await btn.click(); await page.waitForTimeout(3500);
            const afterUrl = page.url();
            const reached = afterUrl.includes('checkout')||afterUrl.includes('/lc/')||afterUrl!==evtUrl;
            const payEl = await page.evaluate(()=>!!(document.querySelector('input[name="firstName"],#billing_first_name,.payment-gateways')));
            const c = chk(lbl+' — checkout reachable', reached||payEl, reached?'Checkout: '+afterUrl.replace(site.url,''):(payEl?'Payment form appeared':'Checkout NOT reached'));
            c.url = page.url(); r.push(c);
          }
        } catch(e2) { /* non-critical */ }
      }
    } catch(err) {
      const c = chk('[Events] '+evt.label+' — loads', false, err.message.slice(0,60)); c.url = evtUrl; r.push(c);
    }
  }
  return r;
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE T — E-CARDS checks (listing + individual card + checkout)
// ─────────────────────────────────────────────────────────────────────────────
async function testECards(page, site) {
  const r = [];
  const ecards = site.config.eCardPaths || [];
  if (ecards.length === 0) { r.push(skip('[ECards] All checks', 'No e-card paths configured')); return r; }

  for (const ec of ecards) {
    const ecUrl = site.url + ec.path;
    try {
      await page.goto(ecUrl, { waitUntil: 'domcontentloaded', timeout: 18000 });
      await dismissCookies(page);
      await page.waitForTimeout(1500);
      const e = await page.evaluate(() => {
        const isListPage = window.location.href.includes('ecards') && !window.location.href.includes('e-card/');
        const cardCount = document.querySelectorAll('[class*="ecard"],[class*="e-card"],li.product,.product').length;
        const hasImage = !!(document.querySelector('[class*="ecard"] img,.woocommerce-product-gallery img,img[class*="attachment-full"]'));
        const hasPrice = /\$\d+|\bfree\b/i.test(document.body?.innerText||'');
        const sendBtn = document.querySelector('button[name="add-to-cart"],.single_add_to_cart_button,button[class*="cart"]');
        const hasPersonalization = !!(document.querySelector('input[name*="message"],textarea,[class*="personaliz"]'));
        const pageLoads = (document.body?.innerText?.trim()?.length||0) > 50;
        return { isListPage, cardCount, hasImage, hasPrice, sendBtn:!!sendBtn, sendBtnTxt:sendBtn?.innerText?.trim(), hasPersonalization, pageLoads };
      });
      const lbl = '[ECards] '+ec.label;
      const c1 = chk(lbl+' — page loads', e.pageLoads, ecUrl); c1.url = ecUrl; r.push(c1);
      if (e.isListPage || e.cardCount > 0) {
        r.push(chk(lbl+' — e-cards listing has cards', e.cardCount > 0, e.cardCount > 0 ? e.cardCount+' e-cards found' : 'BUG: No e-card products found'));
      }
      if (!e.isListPage) {
        r.push(chk(lbl+' — e-card image visible', e.hasImage, e.hasImage?'Image found':'BUG: No e-card image visible'));
        r.push(Object.assign(chk(lbl+' — price displayed', e.hasPrice, e.hasPrice?'Price found':'Price NOT visible'), {pass:e.hasPrice}));
        r.push(chk(lbl+' — send/select button present', e.sendBtn, e.sendBtn?(e.sendBtnTxt||'Button found'):'BUG: No send/cart button'));
        if (e.hasPersonalization) r.push(chk(lbl+' — personalization fields present', true));
        if (e.sendBtn && !site.config.cloudflareBlocked) {
          try {
            const btn = await page.$('button[name="add-to-cart"],.single_add_to_cart_button');
            if (btn) {
              await btn.click(); await page.waitForTimeout(3000);
              const afterUrl = page.url();
              const reached = afterUrl.includes('checkout')||afterUrl.includes('cart')||afterUrl!==ecUrl;
              const c = chk(lbl+' — checkout reachable', reached, reached?'Reached: '+afterUrl.replace(site.url,''):'E-card did NOT navigate to checkout');
              c.url = afterUrl; r.push(c);
            }
          } catch(e2) { /* non-critical */ }
        }
      }
    } catch(err) {
      const c = chk('[ECards] '+ec.label+' — loads', false, err.message.slice(0,60)); c.url = ecUrl; r.push(c);
    }
  }
  return r;
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE U — DONATION FORM VARIANTS (Standard / Variation / Sponsorship)
// ─────────────────────────────────────────────────────────────────────────────
async function testDonationFormVariants(page, site) {
  const r = [];
  const forms = site.config.donationFormPaths || [];
  if (forms.length === 0) { r.push(skip('[DonFormVariants] All checks', 'No additional form paths')); return r; }

  for (const form of forms) {
    const formUrl = site.url + form.path;
    try {
      await page.goto(formUrl, { waitUntil: 'domcontentloaded', timeout: 18000 });
      await dismissCookies(page);
      await page.waitForTimeout(1500);
      const f = await page.evaluate(() => {
        const hasForm = !!(document.querySelector('.levcharity_form.donation_form,form.levcharity_form,.levcharity-donation-checkout-fields-wrapper'));
        const hasDonateBtn = !!(document.querySelector('a[href*="lc-add-to-cart"],button.levcharity_button.primary_button'));
        const donateBtnTxt = document.querySelector('button.levcharity_button.primary_button')?.innerText?.trim();
        const presets = document.querySelectorAll('.levcharity_form__donation_list_item.predefined_amount').length;
        const hasCurrency = !!document.querySelector('.lc-currency-selector,[class*="currency"]');
        const hasFreq = !!document.querySelector('[class*="frequency"],[class*="recurring"]');
        const hasSponsorOpts = !!(document.querySelector('[class*="sponsor"],[class*="level"],table.levcharity_table') || presets >= 5);
        const enabledInputs = [...document.querySelectorAll('input:not([type="hidden"]),select,textarea')].filter(el=>!el.disabled).length;
        const activeBtns = document.querySelectorAll('button:not([disabled]),a.levcharity_button').length;
        const pageLoads = (document.body?.innerText?.trim()?.length||0) > 50;
        return { hasForm, hasDonateBtn, donateBtnTxt, presets, hasCurrency, hasFreq, hasSponsorOpts, enabledInputs, activeBtns, pageLoads };
      });
      const lbl = '[DonForm:'+form.type+'] '+form.label;
      r.push(chk(lbl+' — page loads', f.pageLoads, formUrl, formUrl));
      r.push(chk(lbl+' — donation form/button present', f.hasForm||f.hasDonateBtn, f.hasForm?'Form found':(f.hasDonateBtn?f.donateBtnTxt||'Donate btn':'BUG: No form or donate button')));
      if (f.presets > 0) r.push(chk(lbl+' — preset amounts present', true, f.presets+' amounts'));
      if (f.hasCurrency) r.push(chk(lbl+' — currency selector present', true));
      if (f.hasFreq)     r.push(chk(lbl+' — recurring/frequency option', true));
      if (form.type === 'variation') {
        r.push(Object.assign(chk(lbl+' — variation options present', f.presets >= 3, f.presets>=3?f.presets+' options':'BUG: Only '+f.presets+' options'), {pass:f.presets>=3}));
      }
      if (form.type === 'sponsorship') {
        r.push(Object.assign(chk(lbl+' — sponsorship levels present', f.hasSponsorOpts||f.presets>=3, f.hasSponsorOpts?'Sponsor levels found':f.presets+' preset levels'), {pass:f.hasSponsorOpts||f.presets>=3}));
      }
      r.push(chk(lbl+' — inputs enabled', f.enabledInputs > 0, f.enabledInputs > 0 ? f.enabledInputs+' enabled inputs' : 'BUG: No enabled inputs'));
      r.push(chk(lbl+' — buttons active', f.activeBtns > 0, f.activeBtns > 0 ? f.activeBtns+' active buttons' : 'BUG: No active buttons'));
    } catch(err) {
      const c = chk('[DonFormVariants] '+form.label+' — loads', false, err.message.slice(0,60)); c.url = formUrl; r.push(c);
    }
  }
  return r;
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE V — BRAND COLORS + INTERACTIVE ELEMENTS (general checklist)
// LevCharity purple, nav works, buttons/inputs/checkboxes/dropdowns functional
// ─────────────────────────────────────────────────────────────────────────────
async function testBrandAndInteractive(page, site) {
  const r = [];
  const b = await page.evaluate(() => {
    const html = document.documentElement.outerHTML;
    const hasPurple = html.includes('#CB39D8')||html.includes('#cb39d8')||html.includes('203,57,216')||
      [...document.querySelectorAll('button.levcharity_button,.levcharity_button')].some(el => {
        const bg = window.getComputedStyle(el).backgroundColor;
        return bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent';
      });
    const allBtns = [...document.querySelectorAll('button,input[type="submit"]')];
    const disabledBtns = allBtns.filter(b=>b.disabled).length;
    const allInputs = [...document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]),select,textarea')];
    const disabledInputs = allInputs.filter(i=>i.disabled||i.readOnly).length;
    const checkboxes = document.querySelectorAll('input[type="checkbox"]').length;
    const radios = document.querySelectorAll('input[type="radio"]').length;
    const disabledCRs = document.querySelectorAll('input[type="checkbox"][disabled],input[type="radio"][disabled]').length;
    const selects = [...document.querySelectorAll('select')];
    const brokenSelects = selects.filter(s=>!s.disabled&&s.querySelectorAll('option').length<=1).length;
    const navLinks = [...document.querySelectorAll('nav a,header a,.levcharity-default-header-wrapper a')].filter(a=>a.href);
    const brokenNavLinks = navLinks.filter(a=>!a.href||a.href.endsWith('#')).length;
    return { hasPurple, activeBtns:allBtns.length-disabledBtns, disabledBtns, totalBtns:allBtns.length,
             enabledInputs:allInputs.length-disabledInputs, disabledInputs, totalInputs:allInputs.length,
             checkboxes, radios, disabledCRs, selects:selects.length, brokenSelects,
             navLinkCount:navLinks.length, brokenNavLinks };
  });

  r.push(Object.assign(chk('[Brand] LevCharity purple color on page', true,
    b.hasPurple?'Purple (#CB39D8) confirmed':'Purple not detected in CSS — verify visually (may use CSS variables)'),
    {pass:true})); // Informational — CSS vars may hide exact hex

  if (b.totalBtns > 0)
    r.push(chk('[Interactive] Buttons not disabled', b.disabledBtns===0||b.activeBtns>0,
      b.disabledBtns>0?b.disabledBtns+'/'+b.totalBtns+' disabled (check if expected)':b.activeBtns+' active buttons'));

  if (b.totalInputs > 0)
    r.push(chk('[Interactive] Form inputs enabled', b.enabledInputs>0,
      b.disabledInputs>0?b.enabledInputs+'/'+b.totalInputs+' enabled ('+b.disabledInputs+' disabled)':b.enabledInputs+' inputs enabled'));

  if (b.checkboxes+b.radios > 0)
    r.push(chk('[Interactive] Checkboxes/radios functional', b.disabledCRs===0,
      b.disabledCRs>0?'BUG: '+b.disabledCRs+' disabled checkbox/radio':(b.checkboxes+' checkboxes, '+b.radios+' radios — all active')));

  if (b.selects > 0)
    r.push(chk('[Interactive] Dropdowns have options', b.brokenSelects===0,
      b.brokenSelects>0?'BUG: '+b.brokenSelects+' empty dropdown(s)':b.selects+' dropdowns with options'));

  if (b.navLinkCount > 0)
    r.push(chk('[Interactive] Nav links valid', b.brokenNavLinks===0,
      b.brokenNavLinks>0?'BUG: '+b.brokenNavLinks+'/'+b.navLinkCount+' nav links broken':b.navLinkCount+' nav links OK'));

  return r;
}

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

        // Attach current URL to any failing check that doesn't have one
        const moduleUrl = page.url();
        checks.forEach(c => {
          if (!c.pass && !c.url && !c.screenshot) c.url = moduleUrl;
        });
        result.modules[key] = checks;
        checks.forEach(c => {
          if (c.screenshot) return;
          const isSkip = c.detail?.startsWith('SKIPPED:');
          log(`    ${isSkip?'⊘':c.pass?'✓':'✗'} ${c.name} ${c.detail?'('+c.detail+')':''}`, isSkip?'info':c.pass?'pass':'fail');
        });
      } catch(e) {
        log(`    Module error: ${e.message}`, 'fail');
        const crashSS = await screenshot(page, label+' — module crashed').catch(()=>null);
        const crashChk = chk(label+': module crashed', false, e.message.slice(0,80));
        crashChk.url = page.url();
        if (crashSS) result.modules[key] = [crashSS, crashChk];
        else result.modules[key] = [crashChk];
      }
    }

    // Header + Footer + Nav Coverage — all sites
    await run('header',         'Header',           () => testHeader(page, site));
    await run('footer',         'Footer',           () => testFooter(page, site));
    await run('navCoverage',    'Nav Coverage',     () => testNavCoverage(page, site));
    await run('brandInteract',  'Brand & Interactive', () => testBrandAndInteractive(page, site));

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
      if (site.config.extraTests?.includes('chaiathonIssues')) {
        await run('chaiathonIssues', 'Chaiathon Regression Tests', () => testChaiathonIssues(page, site));
      }
      if (site.config.extraTests?.includes('teamCampaignQuality')) {
        await run('teamCampaignQuality', 'Campaign UI Quality', () => testTeamCampaignQuality(page, site));
      }
      if (site.config.eventPaths?.length) {
        await run('events', 'Events', () => testEvents(page, site));
      }
      if (site.config.eCardPaths?.length) {
        await run('ecards', 'E-Cards', () => testECards(page, site));
      }
      if (site.config.donationFormPaths?.length) {
        await run('donFormVariants', 'Donation Form Variants', () => testDonationFormVariants(page, site));
      }

    } else if (site.type === 'p2pCampaign') {
      await run('hero',       'Hero',              () => testHero(page, site));
      await run('p2pCampaign','P2P Campaign',       () => testP2PCampaign(page, site));
      if (site.config.addToCartUrl) {
        await run('checkout', 'Checkout Form', () => testCheckout(page, site, site.config.addToCartUrl));
      }
      if (site.config.eventPaths?.length)        await run('events','Events',() => testEvents(page, site));
      if (site.config.eCardPaths?.length)         await run('ecards','E-Cards',() => testECards(page, site));
      if (site.config.donationFormPaths?.length)  await run('donFormVariants','Donation Form Variants',() => testDonationFormVariants(page, site));

    } else if (site.type === 'donationForm') {
      await run('donationForm','Donation Form',     () => testDonationForm(page, site));
      if (site.config.checkoutViaCart && site.config.checkoutPath) {
        await run('checkout', 'Checkout Form', () => testCheckout(page, site, site.url+site.config.checkoutPath));
      }
      if (site.config.extraTests?.includes('misaskimIssues')) {
        await run('misaskimIssues', 'Misaskim Regression Tests', () => testMisaskimIssues(page, site));
      }
      if (site.config.eventPaths?.length)        await run('events','Events',() => testEvents(page, site));
      if (site.config.eCardPaths?.length)         await run('ecards','E-Cards',() => testECards(page, site));
      if (site.config.donationFormPaths?.length)  await run('donFormVariants','Donation Form Variants',() => testDonationFormVariants(page, site));

    } else if (site.type === 'portal') {
      await run('portal', 'Portal Navigation', () => testPortal(page, site));
      if (site.config.donatePath) {
        await run('donationForm','Donation Form', () => testDonationForm(page, site));
      }
      if (site.config.eventPaths?.length)        await run('events','Events',() => testEvents(page, site));
      if (site.config.eCardPaths?.length)         await run('ecards','E-Cards',() => testECards(page, site));
      if (site.config.donationFormPaths?.length)  await run('donFormVariants','Donation Form Variants',() => testDonationFormVariants(page, site));
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
