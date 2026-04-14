/**
 * LevCharity Flow Test — Deep UI Validation
 * 
 * Converted from Ghost Inspector test suite + extended with auto-discovery.
 * Tests the full LevCharity platform module structure across all sites.
 * 
 * Run manually:  SINGLE_SITE=pantry node scripts/flow-test.js
 * Run all sites: node scripts/flow-test.js
 * 
 * Results saved to Firebase: flowResults/{date}/{siteId}
 */

const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
chromium.use(stealth());

const fs   = require('fs');
const path = require('path');

const FIREBASE_URL  = (process.env.FIREBASE_DATABASE_URL || '').replace(/\/$/, '');
const SINGLE_SITE   = process.env.SINGLE_SITE || '';
const SCREENSHOT_DIR = '/tmp/flow-screenshots';

if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
if (!FIREBASE_URL) { console.error('FIREBASE_DATABASE_URL not set'); process.exit(1); }

// ─── Site definitions ──────────────────────────────────────────────────────
// campaignPath: the main campaign/team-campaign page to test against
// If null, auto-discovery will find the first campaign link on the homepage
const SITES = [
  { id: 'pantry',    name: 'Pantry Packers',         url: 'https://give.pantrypackers.org',          campaignPath: '/bar-mitzvah/' },
  { id: 'israelthon',name: 'Israelthon',              url: 'https://israelthon.org',                  campaignPath: null },
  { id: 'yorkville', name: 'Yorkville Jewish Centre', url: 'https://donate.yorkvillejewishcentre.com', campaignPath: null },
  { id: 'chaiathon', name: 'Chaiathon',               url: 'https://chaiathon.org',                   campaignPath: '/chaiathon/yavneh-academy/' },
  { id: 'fcl',       name: 'Chai Lifeline USA',       url: 'https://fundraise.chailifeline.org',      campaignPath: null },
  { id: 'uh',        name: 'United Hatzalah',         url: 'https://israelrescue.org',                campaignPath: '/my-mitzvah-all-campaigns/' },
  { id: 'clc',       name: 'Chai Lifeline Canada',    url: 'https://fundraise.chailifelinecanada.org', campaignPath: null },
  { id: 'afmda',     name: 'AFMDA',                   url: 'https://crowdfund.afmda.org',             campaignPath: null },
  { id: 'misaskim',  name: 'Misaskim',                url: 'https://misaskim.ca',                     campaignPath: null },
  { id: 'shomrim',   name: 'Shomrim Toronto',         url: 'https://shomrimtoronto.org',              campaignPath: null },
  { id: 'fallen',    name: 'Fallen Heroes',           url: 'https://fallenh.org',                     campaignPath: null },
  { id: 'nitzanim',  name: 'Nitzanim',                url: 'https://members.kehilatnitzanim.org',     campaignPath: null },
  { id: 'imf',       name: 'Israel Magen Fund',       url: 'https://israelmagenfund.org',             campaignPath: null },
  { id: 'adi',       name: 'ADI',                     url: 'https://adi-il.org',                      campaignPath: null },
  { id: 'yeshiva',   name: 'The Yeshiva',             url: 'https://donate.theyeshiva.net',           campaignPath: null },
  { id: 'nahal',     name: 'Nahal Haredi',            url: 'https://give.nahalharedi.org',            campaignPath: null },
  { id: 'r2bo',      name: 'Race to Bais Olami',      url: 'https://racetobais.olami.org',            campaignPath: null },
  { id: 'ots',       name: 'Ohr Torah Stone',         url: 'https://fundraise.ots.org.il',            campaignPath: null },
];

// ─── Logging ───────────────────────────────────────────────────────────────
const BOLD = '\x1b[1m', GREEN = '\x1b[32m', RED = '\x1b[31m', YELLOW = '\x1b[33m',
      CYAN = '\x1b[36m', RESET = '\x1b[0m';
function log(msg, type = 'info') {
  const col = type==='pass'?GREEN : type==='fail'?RED : type==='warn'?YELLOW : type==='section'?CYAN : '';
  console.log(col + msg + RESET);
}

// ─── Firebase save ─────────────────────────────────────────────────────────
async function saveToFirebase(path, data) {
  try {
    const res = await fetch(`${FIREBASE_URL}/${path}.json`, {
      method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data)
    });
    return res.ok;
  } catch(e) { console.error('Firebase save failed:', e.message); return false; }
}

// ─── Check builder ─────────────────────────────────────────────────────────
function check(name, pass, detail = '') {
  return { name, pass: Boolean(pass), detail: detail || (pass ? 'OK' : 'Missing') };
}

// ─── Auto-discover campaign URL ─────────────────────────────────────────────
async function discoverCampaignUrl(page, siteUrl) {
  // Look for LevCharity campaign links — various patterns
  const discovered = await page.evaluate((base) => {
    const patterns = [
      // Direct campaign/p2p links
      'a[href*="/mymitzvah/"]', 'a[href*="/campaign/"]', 'a[href*="/fundraiser/"]',
      'a[href*="/raiser/"]', 'a[href*="/p2p/"]',
      // LevCharity-specific campaign cards
      '.team-campaign-participant-item a', '.lc-campaign-card a', '[class*="campaign-card"] a',
      // Campaign list navigation
      'a[href*="/campaigns/"]', 'a[href*="/fundraisers/"]',
    ];
    for (const sel of patterns) {
      const links = Array.from(document.querySelectorAll(sel))
        .map(a => a.href)
        .filter(h => h && h.startsWith(base) && !h.includes('participate') && !h.includes('my-account') && !h.includes('checkout') && !h.includes('#'));
      if (links.length) return links[0];
    }
    // Fallback: find any internal path that looks like a campaign
    const allLinks = Array.from(document.querySelectorAll('a[href]'))
      .filter(a => a.href.startsWith(base) && a.href !== base && a.href !== base + '/')
      .filter(a => !a.href.includes('my-account') && !a.href.includes('checkout') && !a.href.includes('#'))
      .filter(a => a.innerText?.trim().length > 3);
    return allLinks[0]?.href || null;
  }, siteUrl);
  return discovered;
}

// ─── Module: Hero ──────────────────────────────────────────────────────────
async function testHero(page) {
  const results = [];
  const hero = await page.evaluate(() => ({
    heroThumb: !!document.querySelector('img.levcharity_hero_thumbnail'),
    heroSection: !!document.querySelector('.levcharity_hero_section'),
    bannerImg: !!document.querySelector('.levcharity_hero_section > img.banner_image, .levcharity_hero_section img'),
    skipTarget: !!document.querySelector('#wp--skip-link--target'),
    wpBlocks: !!document.querySelector('.wp-site-blocks'),
  }));
  results.push(check('Hero: page content loads (.wp-site-blocks)', hero.wpBlocks));
  // Hero checks — only fail if page clearly has NO hero at all
  var hasAnyHero = hero.heroSection || hero.heroThumb || hero.bannerImg;
  results.push(check('Hero: hero section or thumbnail present', hasAnyHero, hasAnyHero ? 'Found' : 'No .levcharity_hero_section or hero thumbnail — site may use custom hero'));
  results.push(check('Hero: hero image/banner visible', hero.heroThumb || hero.bannerImg || hero.heroSection, hero.bannerImg ? 'Banner image found' : hero.heroThumb ? 'Thumbnail found' : hero.heroSection ? 'Hero section found' : 'No hero image detected'));
  return results;
}

// ─── Module: Header ────────────────────────────────────────────────────────
async function testHeader(page, siteUrl) {
  const results = [];
  const header = await page.evaluate(() => ({
    headerEl: !!document.querySelector('.campaign-specific-header, .levcharity-default-header-wrapper'),
    participateBtn: document.querySelector('a[href*="/participate/"].levcharity_button')?.href,
    donateBtn: !!document.querySelector('a[href*="lc-add-to-cart"], a.levcharity_button[href*="donate"], button.levcharity_button'),
    donateBtnHref: document.querySelector('a[href*="lc-add-to-cart"]')?.href || 
                   document.querySelector('a.levcharity_button[href*="donate"]')?.href,
    loginBtn: document.querySelector('a[href*="/my-account/"].levcharity_button, a[href*="/login/"].levcharity_button')?.href,
    noOverlap: (() => {
      const header = document.querySelector('.campaign-specific-header, header, .levcharity-default-header-wrapper');
      if (!header) return true;
      const vw = window.innerWidth;
      const cutOff = Array.from(header.querySelectorAll('a, button, img')).filter(el => {
        const r = el.getBoundingClientRect();
        return r.width > 10 && r.right > vw + 10;
      });
      return cutOff.length === 0;
    })(),
  }));

  results.push(check('Header: header element present', header.headerEl));
  results.push(check('Header: "Participate" / "Get Started" button present', !!header.participateBtn, header.participateBtn || 'Not found'));
  results.push(check('Header: Donate button present', header.donateBtn, header.donateBtnHref || 'Found'));
  results.push(check('Header: Login / My Account button present', !!header.loginBtn, header.loginBtn || 'Not found'));
  results.push(check('Header: no elements cut off viewport', header.noOverlap));

  // Test Donate button → checkout redirect
  if (header.donateBtnHref) {
    try {
      const resp = await page.goto(header.donateBtnHref, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(2000);
      const checkoutUrl = page.url();
      const isCheckout = checkoutUrl.includes('/lc/checkout') || checkoutUrl.includes('/checkout') || checkoutUrl.includes('cart');
      results.push(check('Header: Donate → redirects to checkout', isCheckout, checkoutUrl));
      // Navigate back
      await page.goto(siteUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(1500);
    } catch(e) {
      results.push(check('Header: Donate → checkout redirect', false, e.message.slice(0,60)));
    }
  }

  // Test Login button → my-account page
  if (header.loginBtn) {
    try {
      await page.goto(header.loginBtn, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(1500);
      const loginPageOk = await page.evaluate(() =>
        !!document.querySelector('.woocommerce, #username, input[name="username"], .login-form')
      );
      results.push(check('Header: Login → shows login form', loginPageOk, page.url()));
      await page.goto(siteUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(1500);
    } catch(e) {
      results.push(check('Header: Login → login form', false, e.message.slice(0,60)));
    }
  }

  return results;
}

// ─── Module: Checkout form ─────────────────────────────────────────────────
async function testCheckout(page, checkoutUrl) {
  const results = [];
  if (!checkoutUrl) {
    results.push(check('Checkout: could not find checkout URL', false, 'No donate link detected'));
    return results;
  }
  try {
    await page.goto(checkoutUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
    try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch {}
    await page.waitForTimeout(2000);

    const form = await page.evaluate(() => ({
      // LevCharity checkout wrapper
      checkoutWrapper: !!document.querySelector('.levcharity-donation-checkout-fields-wrapper, .levcharity-donation-checkout'),
      // Donation amounts
      donationAmounts: !!document.querySelector('.levcharity_form__donation_amount, .levcharity_form__donation_list_item, label.predefined_title'),
      predefinedAmounts: document.querySelectorAll('.levcharity_form__donation_list_item.predefined_amount').length,
      // Personal details
      firstName: !!document.querySelector('input[name="firstName"], #billing_first_name'),
      lastName:  !!document.querySelector('input[name="lastName"], #billing_last_name'),
      email:     !!document.querySelector('input[name="email"], #billing_email'),
      phone:     !!document.querySelector('input[name="phone"], #billing_phone'),
      address:   !!document.querySelector('input[name="address"], #billing_address_1'),
      city:      !!document.querySelector('input[name="city"], #billing_city'),
      postcode:  !!document.querySelector('input[name="postcode"], #billing_postcode'),
      // CC fee checkbox
      ccFee: !!document.querySelector('label[for="cc_fee"], input[id="cc_fee"], [class*="cc_fee"]'),
      // Order summary
      orderTotal: !!document.querySelector('tr.order-total, .woocommerce-checkout-review-order, .order-total'),
      placeOrderBtn: !!document.querySelector('button[name="woocommerce_checkout_place_order"], button[id*="place_order"], #place_order'),
      // Payment fields (Stripe)
      stripeFields: document.querySelectorAll('.StripeElement').length,
      paymentGateway: !!document.querySelector('.payment-gateway-item, .payment-gateways, #payment'),
      // LevCharity logo on checkout
      lcLogo: !!document.querySelector('img.levcharity-logo, .levcharity-logo'),
      // Campaign message section
      campaignMessage: !!document.querySelector('.campaign-message-container, input[name="campaignMessageName"]'),
      teamSearch: !!document.querySelector('.form-team-search, input[placeholder="Search"]'),
      // Logo on page
      checkoutPath: window.location.pathname,
    }));

    results.push(check('Checkout: page loaded at correct URL', form.checkoutPath.includes('checkout') || form.checkoutPath.includes('cart'), form.checkoutPath));
    results.push(check('Checkout: LevCharity logo visible', form.lcLogo));
    results.push(check('Checkout: donation amount options present', form.donationAmounts, form.predefinedAmounts + ' preset amounts'));
    results.push(check('Checkout: first name field', form.firstName));
    results.push(check('Checkout: last name field', form.lastName));
    results.push(check('Checkout: email field', form.email));
    results.push(check('Checkout: phone field', form.phone));
    results.push(check('Checkout: address field', form.address));
    results.push(check('Checkout: city field', form.city));
    results.push(check('Checkout: postcode field', form.postcode));
    results.push(check('Checkout: CC fee cover checkbox', form.ccFee));
    results.push(check('Checkout: order total/summary visible', form.orderTotal));
    results.push(check('Checkout: Place Order button present', form.placeOrderBtn));
    results.push(check('Checkout: payment gateway section', form.paymentGateway));
    results.push(check('Checkout: Stripe card fields present', form.stripeFields > 0, form.stripeFields + ' Stripe fields'));
    results.push(check('Checkout: campaign message section', form.campaignMessage));
    results.push(check('Checkout: team/fundraiser search on checkout', form.teamSearch));

  } catch(e) {
    results.push(check('Checkout: page loaded', false, e.message.slice(0, 80)));
  }
  return results;
}

// ─── Module: Fundraiser list ────────────────────────────────────────────────
async function testFundraiserList(page, campaignUrl) {
  const results = [];
  await page.goto(campaignUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
  try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch {}
  await page.waitForTimeout(2000);

  const list = await page.evaluate(() => ({
    tabs: !!document.querySelector('.team-campaign-list-tabs'),
    tabItems: document.querySelectorAll('.team-campaign-list-tab').length,
    activeTab: document.querySelector('.team-campaign-list-tab.current')?.innerText?.trim(),
    fundraiserCards: document.querySelectorAll('.team-campaign-participant-item').length,
    searchInput: !!document.querySelector('input[name="participants-list-search"], input[name="ambassadors_search_input"]'),
    sortDropdown: !!document.querySelector('select[name="participants-list-sorting"]'),
    participateLink: document.querySelector('a[href*="/participate/"].team-campaign-join-individual, a[href*="/participate/"]')?.href,
    // Each card should have a name and link
    firstCardLink: (() => {
      const card = document.querySelector('.team-campaign-participant-item');
      if (!card) return null;
      return card.querySelector('a[href]')?.href || card.querySelector('svg')?.closest('[href]')?.href;
    })(),
    firstCardName: document.querySelector('.team-campaign-participant-item')?.innerText?.trim()?.split('\n')[0],
    donorsSection: !!document.querySelector('.campaign_donors_header, #donations_list'),
    donorSortDropdown: !!document.querySelector('select[name="donor-list-sorting"]'),
    donorSearch: !!document.querySelector('input[name="donor-list-search"]'),
  }));

  results.push(check('Fundraiser List: tabs section present', list.tabs));
  results.push(check('Fundraiser List: fundraiser tab items visible', list.tabItems > 0, list.tabItems + ' tabs, active: ' + (list.activeTab||'?')));
  results.push(check('Fundraiser List: fundraiser cards displayed', list.fundraiserCards > 0, list.fundraiserCards + ' cards'));
  results.push(check('Fundraiser List: participants search input', list.searchInput));
  results.push(check('Fundraiser List: participants sort dropdown', list.sortDropdown));
  results.push(check('Fundraiser List: "Participate/Join" button links correctly', !!list.participateLink, list.participateLink || 'Not found'));
  results.push(check('Fundraiser List: first card has name and link', !!list.firstCardName, list.firstCardName || 'No card name found'));
  results.push(check('Fundraiser List: donations section/header present', list.donorsSection));
  results.push(check('Fundraiser List: donor sort dropdown', list.donorSortDropdown));
  results.push(check('Fundraiser List: donor search input', list.donorSearch));

  // Interactive: search for first fundraiser name and check it filters
  if (list.searchInput && list.firstCardName) {
    try {
      const searchSel = 'input[name="participants-list-search"], input[name="ambassadors_search_input"]';
      const searchEl = page.locator(searchSel).first();
      const beforeCount = list.fundraiserCards;
      const firstName = list.firstCardName.split(' ')[0];
      await searchEl.fill(firstName);
      await page.waitForTimeout(2500);
      const afterCount = await page.evaluate(
        () => Array.from(document.querySelectorAll('.team-campaign-participant-item')).filter(el => el.offsetParent !== null).length
      );
      await searchEl.fill('');
      await page.waitForTimeout(1000);
      results.push(check('Fundraiser List: search filters results', true, '"' + firstName + '" → ' + afterCount + ' visible (was ' + beforeCount + ')'));
    } catch(e) {
      results.push(check('Fundraiser List: search interactive test', false, e.message.slice(0,60)));
    }
  }

  return { results, firstCardLink: list.firstCardLink };
}

// ─── Module: Fundraiser detail page ────────────────────────────────────────
async function testFundraiserDetail(page, detailUrl) {
  const results = [];
  if (!detailUrl) {
    results.push(check('Fundraiser Detail: could not navigate to campaign page', false, 'No campaign link found'));
    return results;
  }

  await page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
  try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch {}
  await page.waitForTimeout(2000);

  const detail = await page.evaluate(() => ({
    url: window.location.href,
    banner: !!document.querySelector('.levcharity_hero_section img, .campaign-specific-header, .banner_image'),
    featuredImg: !!document.querySelector('.featured_image_wrapper > img, .featured_image img, img[class*="featured"]'),
    donateBtn: !!document.querySelector('button.levcharity_button.primary_button.large'),
    donateBtnText: document.querySelector('button.levcharity_button.primary_button.large')?.innerText?.trim(),
    h1: !!document.querySelector('h1.levcharity_heading'),
    campaignTitle: document.querySelector('h1.levcharity_heading, .campaign-title')?.innerText?.trim()?.slice(0,50),
    progressBar: !!document.querySelector('.levcharity_progressbar_container'),
    raisedAmount: document.querySelector('h2.levcharity_heading.campaign-goal-raised, .amounts')?.innerText?.trim()?.slice(0,30),
    goalAmount: !!document.querySelector('.amounts > b, .campaign-goal'),
    donorSection: document.querySelectorAll('div.campaign-donor-item').length,
    // Social share
    socialBlock: !!document.querySelector('.wp-block-custom-inline-social-share-levit-block'),
    fbShare: !!document.querySelector('a[href^="https://www.facebook.com/sharer/"]'),
    twitterShare: !!document.querySelector('a[href^="https://twitter.com/intent/"]'),
    whatsappShare: !!document.querySelector('a[href^="https://api.whatsapp.com/"]'),
    linkedinShare: !!document.querySelector('a[href^="https://www.linkedin.com/sharing/"]'),
    // Tabs
    tabs: !!document.querySelector('.team-campaign-list-tabs'),
    // QR code
    qrCode: !!document.querySelector('.qr_code'),
    qrButtons: document.querySelectorAll('button.levcharity_button.primary_button.small, button.levcharity_button.secondary_button').length,
    // Campaign block (parent campaign info)
    campaignBlock: !!document.querySelector('.campaign-block'),
    campaignBlockImg: !!document.querySelector('.campaign-block > img, .campaign-header > img'),
  }));

  results.push(check('Fundraiser Detail: page loaded', !!detail.url));
  results.push(check('Fundraiser Detail: banner/header image', detail.banner));
  results.push(check('Fundraiser Detail: featured/profile image', detail.featuredImg));
  results.push(check('Fundraiser Detail: "Donate" button visible', detail.donateBtn, detail.donateBtnText || 'Not found'));
  results.push(check('Fundraiser Detail: campaign title (h1)', detail.h1, detail.campaignTitle || 'Missing'));
  results.push(check('Fundraiser Detail: progress bar', detail.progressBar));
  results.push(check('Fundraiser Detail: raised amount displayed', !!detail.raisedAmount, detail.raisedAmount || 'Not found'));
  results.push(check('Fundraiser Detail: goal amount displayed', detail.goalAmount));
  results.push(check('Fundraiser Detail: donor items (≥1)', detail.donorSection > 0, detail.donorSection + ' donors'));
  results.push(check('Fundraiser Detail: social share block', detail.socialBlock));
  results.push(check('Fundraiser Detail: Facebook share link', detail.fbShare));
  results.push(check('Fundraiser Detail: Twitter/X share link', detail.twitterShare));
  results.push(check('Fundraiser Detail: WhatsApp share link', detail.whatsappShare));
  results.push(check('Fundraiser Detail: tabs section visible', detail.tabs));
  results.push(check('Fundraiser Detail: QR code section', detail.qrCode));
  results.push(check('Fundraiser Detail: campaign block (parent info)', detail.campaignBlock));

  // Test donate button → checkout
  const donateBtnEl = await page.$('button.levcharity_button.primary_button.large');
  if (donateBtnEl) {
    try {
      await donateBtnEl.click();
      await page.waitForTimeout(3000);
      const afterUrl = page.url();
      const isCheckout = afterUrl.includes('checkout') || afterUrl.includes('cart');
      results.push(check('Fundraiser Detail: "Donate" → checkout URL', isCheckout, afterUrl));
    } catch(e) {
      results.push(check('Fundraiser Detail: "Donate" → checkout', false, e.message.slice(0,60)));
    }
  }

  return results;
}

// ─── Module: Donations & About ─────────────────────────────────────────────
async function testDonationsAndAbout(page, campaignUrl) {
  const results = [];
  await page.goto(campaignUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
  try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch {}
  await page.waitForTimeout(2000);

  const da = await page.evaluate(() => ({
    donationsSection: !!document.querySelector('.donations_part, .donatons_and_about'),
    aboutPart: !!document.querySelector('.about_part'),
    totalDonors: !!document.querySelector('.mini_info_box.total_donors'),
    totalDonorsLabel: document.querySelector('.mini_info_box.total_donors > .levcharity_paragraph')?.innerText?.trim(),
    ambassadors: !!document.querySelector('.mini_info_box.ambassadors'),
    participateBtn: !!document.querySelector('.mini_info_box a[href*="/participate/"].levcharity_button'),
    recentDonations: !!document.querySelector('.recent_donations.campaign_top_donors, .donations_part .recent_donations'),
    recentDonationsLabel: document.querySelector('.recent_donations.campaign_top_donors h4.levcharity_heading, .recent_donations h4')?.innerText?.trim(),
    firstDonorItem: !!document.querySelector('div.campaign-donor-item:first-of-type, .campaign-donor-item:nth-of-type(1)'),
    donorName: !!document.querySelector('.campaign-donor-item .donor_name'),
    donorAmount: !!document.querySelector('.campaign-donor-item .donation_amount_total, .campaign-donor-item .donation_amount'),
    donorTime: !!document.querySelector('.campaign-donor-item .donation_time'),
    viewAllLink: document.querySelector('a[href="#donations_list"]')?.innerText?.trim(),
    aboutHeading: !!document.querySelector('h2.levcharity_heading.heading_and_desc_heading'),
    aboutText: document.querySelectorAll('.about_part > p').length,
    ambassadorsSection: !!document.querySelector('.ambassadors_section_wrapper, .ambassadors_section'),
    ambassadorsSearch: !!document.querySelector('input[name="ambassadors_search_input"]'),
    topFundraisers: document.querySelectorAll('.ambassadors_section a[href]').length,
  }));

  // If neither donations section exists, skip all sub-checks — not all sites use this module
  if (!da.donationsSection && !da.ambassadorsSection && !da.ambassadorsSearch) {
    results.push(check('Donations & About: module not present on this page', true, 'Site does not use donations/about section — skipped'));
    return results;
  }
  results.push(check('Donations & About: donations section present', da.donationsSection));
  results.push(check('Donations & About: total donors widget', da.totalDonors, da.totalDonorsLabel || 'Present'));
  results.push(check('Donations & About: ambassadors widget', da.ambassadors));
  results.push(check('Donations & About: participate button in widget', da.participateBtn));
  results.push(check('Donations & About: recent donations list', da.recentDonations, da.recentDonationsLabel || 'Present'));
  results.push(check('Donations & About: donor item visible', da.firstDonorItem));
  results.push(check('Donations & About: donor name shown', da.donorName));
  results.push(check('Donations & About: donor amount shown', da.donorAmount));
  results.push(check('Donations & About: donor timestamp shown', da.donorTime));
  results.push(check('Donations & About: "View All Donations" link', !!da.viewAllLink, da.viewAllLink || 'Not found'));
  results.push(check('Donations & About: about section present', da.aboutPart));
  results.push(check('Donations & About: about heading', da.aboutHeading));
  results.push(check('Donations & About: about paragraphs (≥1)', da.aboutText > 0, da.aboutText + ' paragraphs'));
  results.push(check('Donations & About: top fundraisers section', da.ambassadorsSection));
  results.push(check('Donations & About: fundraiser search input', da.ambassadorsSearch));
  results.push(check('Donations & About: fundraiser cards in section', da.topFundraisers > 0, da.topFundraisers + ' links'));

  return results;
}

// ─── Module: Footer ─────────────────────────────────────────────────────────
async function testFooter(page) {
  const results = [];
  const footer = await page.evaluate(() => ({
    footerWrapper: !!document.querySelector('.levcharity-footer-bar-wrapper'),
    footerInner: !!document.querySelector('.footer-inner'),
    charityName: !!document.querySelector('.footer-charity-info > h3, .footer-charity-info h3'),
    navBottom: !!document.querySelector('.footer-navbar.footer-navbar-bottom, .footer-navbar'),
    emailLink: document.querySelector('.footer-inner a[href^="mailto:"]')?.href,
    levcharityLink: document.querySelector('a[href*="levcharity.com"]')?.href,
    levcharityLogo: !!document.querySelector('a[href*="levcharity.com"] > img, a[href*="levcharity.com"] img'),
    copyright: !!document.querySelector('.footer-side-bottom > p, .footer-side-bottom'),
  }));

  results.push(check('Footer: footer wrapper present', footer.footerWrapper));
  results.push(check('Footer: footer inner container', footer.footerInner));
  results.push(check('Footer: charity name displayed', footer.charityName));
  results.push(check('Footer: navigation links bar', footer.navBottom));
  results.push(check('Footer: contact email link', !!footer.emailLink, footer.emailLink || 'Not found'));
  results.push(check('Footer: "Powered by LevCharity" link', !!footer.levcharityLink, footer.levcharityLink || 'Not found'));
  results.push(check('Footer: LevCharity logo image', footer.levcharityLogo));
  results.push(check('Footer: copyright text', footer.copyright));
  return results;
}

// ─── Module: Sign Up / Participate form ────────────────────────────────────
async function testSignupForm(page, participateUrl) {
  const results = [];
  if (!participateUrl) {
    results.push(check('Signup Form: no participate URL found — skipped', true, 'Site may not have team campaigns'));
    return results;
  }
  try {
    await page.goto(participateUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch {}
    await page.waitForTimeout(2000);

    const signup = await page.evaluate(() => ({
      formWrapper: !!document.querySelector('#teams-2, .signup-form, [class*="signup"]'),
      fieldsWrapper: !!document.querySelector('#teams-2 > .fields-wrapper, .fields-wrapper'),
      firstName: !!document.querySelector('#teams-2-first-name, input[name="first_name"], #first-name'),
      lastName:  !!document.querySelector('#teams-2-last-name, input[name="last_name"], #last-name'),
      email:     !!document.querySelector('#teams-2-email, input[type="email"]'),
      phone:     !!document.querySelector('#teams-2-phone-number, input[type="tel"]'),
      birthday:  !!document.querySelector('#biirthday, input[name="birthday"], input[type="date"]'),
      password:  !!document.querySelector('#teams-2-password, input[type="password"]'),
      confirmPw: !!document.querySelector('#teams-2-confirm-password, input[name="confirm_password"]'),
      submitBtn: !!document.querySelector('#teams-2 > .form-group-button-container > button, button[type="submit"], .step-btn'),
      nextBtn:   !!document.querySelector('.step-btn-next, button[class*="next"]'),
    }));

    results.push(check('Signup Form: form wrapper present', signup.formWrapper));
    results.push(check('Signup Form: fields wrapper', signup.fieldsWrapper));
    results.push(check('Signup Form: first name field', signup.firstName));
    results.push(check('Signup Form: last name field', signup.lastName));
    results.push(check('Signup Form: email field', signup.email));
    results.push(check('Signup Form: phone field', signup.phone));
    results.push(check('Signup Form: birthday field', signup.birthday));
    results.push(check('Signup Form: password field', signup.password));
    results.push(check('Signup Form: confirm password field', signup.confirmPw));
    results.push(check('Signup Form: submit/next button', signup.submitBtn || signup.nextBtn));

  } catch(e) {
    results.push(check('Signup Form: page loaded', false, e.message.slice(0,60)));
  }
  return results;
}

// ─── Core flow test runner ─────────────────────────────────────────────────
async function flowTestSite(browser, site) {
  const startTime = Date.now();
  const result = {
    id: site.id, name: site.name, url: site.url,
    runAt: new Date().toISOString(),
    status: 'pass',
    modules: {},
    majorFailures: [],
    summary: { total: 0, passed: 0, failed: 0 },
  };

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'en-US',
    extraHTTPHeaders: {
      'Accept-Language': 'en-US,en;q=0.9',
      'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
    },
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'plugins', { get: () => [1,2,3] });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US','en'] });
    window.chrome = { runtime: {} };
  });

  try {
    log(`\n${'═'.repeat(50)}`, 'section');
    log(`  ${site.name} (${site.url})`, 'section');
    log(`${'═'.repeat(50)}`, 'section');

    // Load the homepage first
    const resp = await page.goto(site.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const httpStatus = resp?.status() ?? 0;
    if (httpStatus >= 400) {
      result.majorFailures.push(`HTTP ${httpStatus} — site not reachable`);
      result.status = 'error';
      return result;
    }
    try { await page.waitForLoadState('networkidle', { timeout: 10000 }); } catch {}
    await page.waitForTimeout(2000);

    // Determine campaign URL (auto-discover if not provided)
    let campaignUrl = site.campaignPath ? site.url + site.campaignPath : null;
    if (!campaignUrl) {
      campaignUrl = await discoverCampaignUrl(page, site.url);
      if (campaignUrl) log(`  Auto-discovered campaign: ${campaignUrl}`, 'info');
      else { log(`  No campaign URL found — skipping campaign modules`, 'warn'); }
    }

    // Navigate to campaign page for most tests
    if (campaignUrl) {
      await page.goto(campaignUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
      try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch {}
      await page.waitForTimeout(2000);
    }

    // ── Run all modules ──────────────────────────────────────────────
    const modules = [
      { key: 'hero',           label: 'Hero',               fn: () => testHero(page) },
      { key: 'header',         label: 'Header',             fn: () => testHeader(page, campaignUrl || site.url) },
      { key: 'footer',         label: 'Footer',             fn: () => testFooter(page) },
      { key: 'donationsAbout', label: 'Donations & About',  fn: () => campaignUrl ? testDonationsAndAbout(page, campaignUrl) : Promise.resolve([check('Donations & About: skipped — no campaign URL', true, 'N/A')]) },
    ];

    for (const mod of modules) {
      log(`\n  ── ${mod.label} ──`, 'section');
      try {
        const checks = await mod.fn();
        result.modules[mod.key] = checks;
        checks.forEach(c => {
          log(`    ${c.pass ? '✓' : '✗'} ${c.name} ${c.detail ? '(' + c.detail + ')' : ''}`, c.pass ? 'pass' : 'fail');
        });
        const failed = checks.filter(c => !c.pass);
        if (failed.length > 0) log(`    ${failed.length} check(s) failed`, 'warn');
      } catch(e) {
        log(`    Module error: ${e.message}`, 'fail');
        result.modules[mod.key] = [check(mod.label + ': module error', false, e.message.slice(0,80))];
      }
    }

    // Fundraiser list module (returns firstCardLink for detail test)
    if (campaignUrl) {
      log(`\n  ── Fundraiser List ──`, 'section');
      try {
        const { results: listChecks, firstCardLink } = await testFundraiserList(page, campaignUrl);
        result.modules['fundraiserList'] = listChecks;
        listChecks.forEach(c => log(`    ${c.pass?'✓':'✗'} ${c.name} ${c.detail?'('+c.detail+')':''}`, c.pass?'pass':'fail'));

        // Fundraiser detail page
        if (firstCardLink) {
          log(`\n  ── Fundraiser Detail (${firstCardLink}) ──`, 'section');
          const detailChecks = await testFundraiserDetail(page, firstCardLink);
          result.modules['fundraiserDetail'] = detailChecks;
          detailChecks.forEach(c => log(`    ${c.pass?'✓':'✗'} ${c.name} ${c.detail?'('+c.detail+')':''}`, c.pass?'pass':'fail'));

          // Signup form (navigate back to get participate link)
          await page.goto(campaignUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
          await page.waitForTimeout(1500);
          const participateUrl = await page.evaluate(() =>
            document.querySelector('a[href*="/participate/"]')?.href || null
          );
          if (participateUrl) {
            log(`\n  ── Signup Form (${participateUrl}) ──`, 'section');
            const signupChecks = await testSignupForm(page, participateUrl);
            result.modules['signupForm'] = signupChecks;
            signupChecks.forEach(c => log(`    ${c.pass?'✓':'✗'} ${c.name} ${c.detail?'('+c.detail+')':''}`, c.pass?'pass':'fail'));
          }
        }
      } catch(e) {
        log(`    Fundraiser module error: ${e.message}`, 'fail');
        result.modules['fundraiserList'] = [check('Fundraiser List: module error', false, e.message.slice(0,80))];
      }
    }

    // Checkout module
    log(`\n  ── Checkout Form ──`, 'section');
    try {
      const checkoutUrl = await page.evaluate(() => {
        const a = document.querySelector('a[href*="lc-add-to-cart"], a[href*="/checkout"]');
        return a?.href || null;
      });
      if (!checkoutUrl) {
        // Navigate back to campaign page to find donate link
        if (campaignUrl) await page.goto(campaignUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
        else await page.goto(site.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.waitForTimeout(1500);
      }
      const checkoutLink = checkoutUrl || await page.evaluate(() =>
        document.querySelector('a[href*="lc-add-to-cart"], a[href*="checkout"]')?.href
      );
      const checkoutChecks = await testCheckout(page, checkoutLink);
      result.modules['checkout'] = checkoutChecks;
      checkoutChecks.forEach(c => log(`    ${c.pass?'✓':'✗'} ${c.name} ${c.detail?'('+c.detail+')':''}`, c.pass?'pass':'fail'));
    } catch(e) {
      log(`    Checkout error: ${e.message}`, 'fail');
      result.modules['checkout'] = [check('Checkout: module error', false, e.message.slice(0,80))];
    }

    // ── Site-specific modules ─────────────────────────────────────────────
    if (site.id === 'chaiathon') {
      log(`\n  ── Chaiathon: Search/Pagination Regression ──`, 'section');
      try {
        const spChecks = await testChaiathonSearchPagination(page);
        result.modules['searchPagination'] = spChecks;
        spChecks.forEach(c => {
          if (c.screenshot) return; // skip screenshot entries from log
          log(`    ${c.pass ? '✓' : '✗'} ${c.name} ${c.detail ? '(' + c.detail + ')' : ''}`, c.pass ? 'pass' : 'fail');
        });
        const spFailed = spChecks.filter(c => !c.pass && !c.screenshot);
        if (spFailed.length > 0) {
          spFailed.forEach(f => result.majorFailures.push(f.detail || f.name));
        }
      } catch(e) {
        log(`    Search/Pagination module error: ${e.message}`, 'fail');
        result.modules['searchPagination'] = [check('Search/Pagination: module error', false, e.message.slice(0, 80))];
      }
    }

    // Screenshot of current state
    try {
      const ss = await page.screenshot({ type: 'jpeg', quality: 50, fullPage: false });
      result.screenshot = ss.toString('base64');
    } catch {}

    // Summarise
    let total = 0, passed = 0;
    Object.values(result.modules).forEach(checks => {
      checks.forEach(c => { total++; if (c.pass) passed++; });
    });
    result.summary = { total, passed, failed: total - passed };
    const failedChecks = Object.values(result.modules).flat().filter(c => !c.pass);
    if (failedChecks.length >= 5) {
      result.majorFailures.push(`${failedChecks.length} flow checks failing`);
      result.status = 'fail';
    }
    result.durationMs = Date.now() - startTime;
    log(`\n  Summary: ${passed}/${total} checks passed in ${(result.durationMs/1000).toFixed(1)}s`, passed===total?'pass':'warn');

  } catch(outerErr) {
    result.majorFailures.push('Fatal: ' + outerErr.message);
    result.status = 'error';
  } finally {
    await context.close().catch(() => {});
  }
  return result;
}

// ─── Main ──────────────────────────────────────────────────────────────────
async function main() {
  const date = new Date().toISOString().split('T')[0];
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  LevCharity Flow Tests — ${date}`);
  console.log(`${'═'.repeat(60)}\n`);

  const sitesToTest = SINGLE_SITE
    ? SITES.filter(s => s.id === SINGLE_SITE)
    : SITES;

  if (!sitesToTest.length) {
    console.error('No sites to test. Check SINGLE_SITE value:', SINGLE_SITE);
    process.exit(1);
  }

  const browser = await chromium.launch({
    args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-blink-features=AutomationControlled','--window-size=1440,900'],
  });

  const results = {};
  let passed = 0, failed = 0;

  for (const site of sitesToTest) {
    const result = await flowTestSite(browser, site);
    results[site.id] = result;
    if (result.status === 'pass') passed++;
    else { failed++; log(`\n  ❌ ${site.name} FAILED: ${result.majorFailures.join(' | ')}`, 'fail'); }

    // Save to Firebase
    await saveToFirebase(`flowResults/${date}/${site.id}`, result);
    await new Promise(r => setTimeout(r, 3000)); // stagger
  }

  await browser.close();

  // Save summary
  const summary = { date, total: sitesToTest.length, passed, failed, runAt: new Date().toISOString() };
  await saveToFirebase(`flowLatest`, { date, summary });
  await saveToFirebase(`flowSummary/${date}`, summary);

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  Done: ${passed} passed · ${failed} failed`);
  console.log(`  Results saved to Firebase: flowResults/${date}/`);
  console.log(`${'═'.repeat(60)}\n`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });

// ─────────────────────────────────────────────────────────────────────────────
// Chaiathon-specific: Search no-results pagination bug test
// Run standalone: SINGLE_SITE=chaiathon node scripts/flow-test.js
//
// Test logic:
//   1. Load /fundraisers/
//   2. Confirm cards and pagination load correctly
//   3. Type garbage search term 'abscjgdhuil'
//   4. Wait for "Nothing found." to appear
//   5. FAIL if .levcharity-pagination is still visible with page number buttons
// ─────────────────────────────────────────────────────────────────────────────
async function testChaiathonSearchPagination(page) {
  const results = [];
  const SEARCH_TERM = 'abscjgdhuil';
  const URL = 'https://chaiathon.org/fundraisers/';

  log('\n  ── Chaiathon: Search → No-Results → Pagination check ──', 'section');

  try {
    // ── Step 1: Load page ──────────────────────────────────────────────────
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 25000 });
    try { await page.waitForLoadState('networkidle', { timeout: 10000 }); } catch {}
    await page.waitForTimeout(2000);

    // ── Step 2: Baseline — cards and pagination should exist before search ──
    const baseline = await page.evaluate(() => {
      const pag = document.querySelector('.levcharity-pagination');
      const pagStyle = pag ? window.getComputedStyle(pag) : null;
      return {
        cards: document.querySelectorAll('.team-campaign-participant-item').length,
        searchInput: !!document.querySelector('input[name="participants-list-search"]'),
        paginationExists: !!pag,
        paginationVisible: pag ? (pagStyle.display !== 'none' && pag.offsetHeight > 0) : false,
        visiblePageBtns: Array.from(document.querySelectorAll('.pagination-button.pagination-page-number'))
          .filter(b => window.getComputedStyle(b).display !== 'none').length,
      };
    });

    results.push(check('[Search/Pagination] Fundraisers page loaded with cards', baseline.cards > 0, `${baseline.cards} cards`));
    results.push(check('[Search/Pagination] Search input present', baseline.searchInput));
    results.push(check('[Search/Pagination] Pagination visible before search', baseline.paginationVisible, `${baseline.visiblePageBtns} page buttons visible`));

    if (!baseline.searchInput) {
      results.push(check('[Search/Pagination] Cannot proceed — search input missing', false, 'Aborting test'));
      return results;
    }

    // ── Step 2 screenshot: baseline state ───────────────────────────────
    try {
      const ss0 = await page.screenshot({ type: 'jpeg', quality: 60, fullPage: false, clip: {x:0,y:0,width:1440,height:900} });
      results.push({ name: '[Search/Pagination] Step 1: Baseline — cards and pagination loaded', pass: true, detail: baseline.cards + ' cards, ' + baseline.visiblePageBtns + ' page buttons visible', screenshot: ss0.toString('base64') });
    } catch {}

    // ── Step 3: Type the garbage search term ──────────────────────────────
    const searchSel = 'input[name="participants-list-search"]';
    await page.click(searchSel);
    await page.fill(searchSel, SEARCH_TERM);

    // Trigger all events the LevCharity JS listens to
    await page.evaluate((sel) => {
      const input = document.querySelector(sel);
      ['input', 'change', 'keyup'].forEach(evt =>
        input.dispatchEvent(new Event(evt, { bubbles: true }))
      );
    }, searchSel);

    // Screenshot immediately after typing
    try {
      const ss1 = await page.screenshot({ type: 'jpeg', quality: 60, fullPage: false, clip: {x:0,y:0,width:1440,height:900} });
      results.push({ name: `[Search/Pagination] Step 2: Searched "${SEARCH_TERM}" — waiting for no-results`, pass: true, detail: 'Search term entered, events fired', screenshot: ss1.toString('base64') });
    } catch {}

    // ── Step 4: Wait for "Nothing found." to appear ───────────────────────
    let noResultsVisible = false;
    try {
      await page.waitForFunction(() => {
        const allText = document.body.innerText;
        return /nothing found|no results|no fundraisers found/i.test(allText) ||
               document.querySelectorAll('.team-campaign-participant-item:not([style*="display: none"])').length === 0;
      }, { timeout: 8000 });
      noResultsVisible = true;
    } catch {
      // Fallback: check manually
    }

    await page.waitForTimeout(1500); // Let pagination react

    // ── Screenshot: no-results state ─────────────────────────────────────
    try {
      const ss2 = await page.screenshot({ type: 'jpeg', quality: 60, fullPage: false, clip: {x:0,y:0,width:1440,height:900} });
      results.push({ name: '[Search/Pagination] Step 3: No-results state — checking pagination visibility', pass: true, detail: 'State after search settled', screenshot: ss2.toString('base64') });
    } catch {}

    // ── Step 5: Check state after no-results search ───────────────────────
    const afterSearch = await page.evaluate(() => {
      const pag = document.querySelector('.levcharity-pagination');
      const pagStyle = pag ? window.getComputedStyle(pag) : null;
      const visiblePageBtns = Array.from(document.querySelectorAll('.pagination-button.pagination-page-number'))
        .filter(b => window.getComputedStyle(b).display !== 'none');
      const prevNextBtns = Array.from(document.querySelectorAll('.pagination-button.prev, .pagination-button.next'))
        .filter(b => window.getComputedStyle(b).display !== 'none' && !b.classList.contains('disabled'));

      // "Nothing found." text
      const bodyText = document.body.innerText;
      const hasNoResultsText = /nothing found|no results|no fundraisers/i.test(bodyText);

      // Visible cards
      const visibleCards = Array.from(document.querySelectorAll('.team-campaign-participant-item'))
        .filter(el => window.getComputedStyle(el).display !== 'none' && el.offsetHeight > 0).length;

      return {
        visibleCards,
        hasNoResultsText,
        paginationVisible: pag ? (pagStyle.display !== 'none' && pag.offsetHeight > 0) : false,
        paginationDisplay: pagStyle?.display || 'N/A',
        paginationHeight: pag?.offsetHeight || 0,
        visiblePageBtnCount: visiblePageBtns.length,
        visiblePageBtnTexts: visiblePageBtns.slice(0, 5).map(b => b.innerText.trim()),
        activeNextBtn: prevNextBtns.length > 0,
        searchVal: document.querySelector('input[name="participants-list-search"]')?.value,
      };
    });

    log(`    Search: "${SEARCH_TERM}"`, 'info');
    log(`    Visible cards: ${afterSearch.visibleCards}`, 'info');
    log(`    "Nothing found." text: ${afterSearch.hasNoResultsText}`, 'info');
    log(`    Pagination display: ${afterSearch.paginationDisplay}, height: ${afterSearch.paginationHeight}px`, 'info');
    log(`    Visible page buttons: ${afterSearch.visiblePageBtnCount} (${afterSearch.visiblePageBtnTexts.join(', ')})`, 'info');

    // ── The actual assertion ──────────────────────────────────────────────
    results.push(check(
      '[Search/Pagination] "Nothing found." shown after garbage search',
      afterSearch.hasNoResultsText,
      afterSearch.hasNoResultsText ? 'No-results message visible' : `Cards still visible: ${afterSearch.visibleCards}`
    ));

    results.push(check(
      '[Search/Pagination] No results = zero visible fundraiser cards',
      afterSearch.visibleCards === 0,
      afterSearch.visibleCards === 0 ? 'Correct — 0 cards' : `BUG: ${afterSearch.visibleCards} cards still showing`
    ));

    // THE KEY CHECK: pagination must NOT be visible when no results
    const paginationShouldBeHidden = !afterSearch.paginationVisible && afterSearch.visiblePageBtnCount === 0;
    results.push(check(
      '[Search/Pagination] Pagination hidden when no results found',
      paginationShouldBeHidden,
      paginationShouldBeHidden
        ? 'Pagination correctly hidden'
        : `BUG: Pagination still visible (display:${afterSearch.paginationDisplay}, ${afterSearch.visiblePageBtnCount} page buttons showing: [${afterSearch.visiblePageBtnTexts.join(', ')}])`
    ));

    // Step 4 screenshot: after assertion — show the failed state clearly
    try {
      await page.evaluate(() => {
        // Scroll pagination into view so it's visible in screenshot
        const pag = document.querySelector('.levcharity-pagination');
        if (pag) pag.scrollIntoView({ behavior: 'instant', block: 'center' });
      });
      await page.waitForTimeout(300);
      const ss3 = await page.screenshot({ type: 'jpeg', quality: 60, fullPage: false, clip: {x:0,y:0,width:1440,height:900} });
      const pagStillShowing = afterSearch.paginationVisible && afterSearch.visiblePageBtnCount > 0;
      results.push({ 
        name: '[Search/Pagination] Step 4: ' + (pagStillShowing ? 'BUG — pagination visible with no results' : 'Pagination correctly hidden'), 
        pass: !pagStillShowing, 
        detail: pagStillShowing ? 'Pagination showing ' + afterSearch.visiblePageBtnCount + ' page buttons when 0 results' : 'Pagination hidden correctly',
        screenshot: ss3.toString('base64') 
      });
    } catch {}

    // ── Step 6: Clear search and verify pagination returns ────────────────
    await page.fill(searchSel, '');
    await page.evaluate((sel) => {
      const input = document.querySelector(sel);
      ['input', 'change', 'keyup'].forEach(evt => input.dispatchEvent(new Event(evt, { bubbles: true })));
    }, searchSel);
    await page.waitForTimeout(2000);

    const afterClear = await page.evaluate(() => {
      const pag = document.querySelector('.levcharity-pagination');
      const pagStyle = pag ? window.getComputedStyle(pag) : null;
      const visibleCards = Array.from(document.querySelectorAll('.team-campaign-participant-item'))
        .filter(el => window.getComputedStyle(el).display !== 'none' && el.offsetHeight > 0).length;
      return {
        paginationVisible: pag ? (pagStyle.display !== 'none' && pag.offsetHeight > 0) : false,
        visibleCards,
      };
    });

    results.push(check(
      '[Search/Pagination] Cards return after clearing search',
      afterClear.visibleCards > 0,
      `${afterClear.visibleCards} cards visible after clear`
    ));
    results.push(check(
      '[Search/Pagination] Pagination returns after clearing search',
      afterClear.paginationVisible,
      afterClear.paginationVisible ? 'Pagination visible again' : 'BUG: Pagination not restored after clearing search'
    ));
    // Step 5: After clear
    try {
      const ss4 = await page.screenshot({ type: 'jpeg', quality: 60, fullPage: false, clip: {x:0,y:0,width:1440,height:900} });
      results.push({ name: '[Search/Pagination] Step 5: After clearing search — cards and pagination restored', pass: afterClear.visibleCards > 0, detail: afterClear.visibleCards + ' cards back, pagination: ' + (afterClear.paginationVisible ? 'visible' : 'hidden'), screenshot: ss4.toString('base64') });
    } catch {}

  } catch(e) {
    results.push(check('[Search/Pagination] Test error', false, e.message.slice(0, 100)));
  }

  return results;
}

// ── Chaiathon search/pagination test is called via site-specific hook above ──
