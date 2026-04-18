/**
 * Levi — Universal Adaptive Smoke Test
 * powered by leverage.it
 *
 * Desktop + Mobile visual testing with highlighted screenshot evidence.
 * Auto-detects platform (WordPress, Elementor, Shopify, Wix, Webflow, WooCommerce, etc.)
 *
 * Usage:
 *   FIREBASE_DATABASE_URL=xxx CUSTOM_URL=https://example.com node scripts/adaptive-smoke.js
 *
 * Env vars:
 *   CUSTOM_URL        Required.
 *   SITE_NAME         Optional display name
 *   SITE_TYPE         Optional platform override
 *   SITE_NAMESPACE    Optional Firebase namespace (auto from URL)
 *   CLIENT_ID         Optional client partition
 *   FIREBASE_DATABASE_URL  Required.
 */

'use strict';
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
chromium.use(stealth());

const FIREBASE_URL = (process.env.FIREBASE_DATABASE_URL || '').replace(/\/$/, '');
const CUSTOM_URL   = process.env.CUSTOM_URL || '';
const SITE_NAME    = process.env.SITE_NAME  || '';
const CLIENT_ID    = process.env.CLIENT_ID  || '';
const FORCE_TYPE   = process.env.SITE_TYPE  || '';

if (!FIREBASE_URL) { console.error('FIREBASE_DATABASE_URL not set'); process.exit(1); }
if (!CUSTOM_URL)   { console.error('CUSTOM_URL not set'); process.exit(1); }

const urlObj = new URL(CUSTOM_URL.startsWith('http') ? CUSTOM_URL : 'https://' + CUSTOM_URL);
const hostname = urlObj.hostname.replace('www.', '');
const SITE_NAMESPACE = process.env.SITE_NAMESPACE || hostname.replace(/[^a-zA-Z0-9]/g, '_').replace(/__+/g, '_');
const DISPLAY_NAME   = SITE_NAME || hostname;

const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', C = '\x1b[36m', RESET = '\x1b[0m';
const log = (msg, t = 'info') => console.log((t==='pass'?G:t==='fail'?R:t==='warn'?Y:t==='section'?C:'') + msg + RESET);

// ─────────────────────────────────────────────────────────────────────────────
// PLATFORM DETECTION
// ─────────────────────────────────────────────────────────────────────────────
async function detectPlatform(page) {
  if (FORCE_TYPE) return FORCE_TYPE;
  return await page.evaluate(() => {
    const html = document.documentElement.innerHTML.toLowerCase();
    const body = document.body?.className?.toLowerCase() || '';
    // WooCommerce first (before WordPress) — more specific
    if (html.includes('woocommerce') || document.querySelector('.woocommerce,.wc-block-grid')) return 'woocommerce';
    // WordPress builders — most specific first
    if (html.includes('elementor') || document.querySelector('[data-elementor-type],[class*="elementor-"]')) return 'elementor';
    if (html.includes('et_pb') || html.includes('divi') || body.includes('et-db')) return 'divi';
    if (document.querySelector('.wp-block-group, .wp-block-cover, .wp-block-columns, [class*="wp-block"]')) return 'gutenberg';
    // Generic WordPress
    if (html.includes('wp-content') || html.includes('wp-includes') || html.includes('wordpress')) return 'wordpress';
    // Platforms
    if (html.includes('cdn.shopify.com') || window.Shopify) return 'shopify';
    if (html.includes('squarespace') || html.includes('squarespace-cdn')) return 'squarespace';
    if (html.includes('wix.com') || html.includes('wixsite') || html.includes('parastorage.com')) return 'wix';
    if (html.includes('webflow') || html.includes('wf-site-id') || document.querySelector('[data-wf-site]')) return 'webflow';
    if (window.__NEXT_DATA__ || document.querySelector('#__next')) return 'react';
    if (window.React || document.querySelector('#root,#app,[data-reactroot]')) return 'react';
    return 'custom';
  }).catch(() => 'custom');
}

// ─────────────────────────────────────────────────────────────────────────────
// SCREENSHOT WITH CANVAS HIGHLIGHTS
// Draws coloured bounding boxes over elements that have issues
// ─────────────────────────────────────────────────────────────────────────────
async function screenshotWithHighlights(page, highlights) {
  // highlights = [{selector, label, color, reason}]
  // Draw overlays via canvas injection, take screenshot, clean up
  if (highlights && highlights.length > 0) {
    await page.evaluate((hl) => {
      const canvas = document.createElement('canvas');
      canvas.id = '__levi_overlay__';
      canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:99999999';
      canvas.width  = window.innerWidth;
      canvas.height = window.innerHeight;
      document.body.appendChild(canvas);
      const ctx = canvas.getContext('2d');

      hl.forEach(function(h) {
        const COLORS = { red:'#FF4757', amber:'#FFB300', blue:'#4338CA', green:'#059669' };
        const color = COLORS[h.color] || COLORS.red;
        let els = [];
        if (h.selector) {
          try { els = [...document.querySelectorAll(h.selector)].filter(el => el.offsetParent !== null).slice(0, 8); }
          catch(e) {}
        }
        if (h.rect) { els = [{ getBoundingClientRect: () => h.rect }]; }
        els.forEach(function(el) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) return;
          // Red/amber box
          ctx.strokeStyle = color;
          ctx.lineWidth = 3;
          ctx.strokeRect(r.left + 1, r.top + 1, r.width - 2, r.height - 2);
          // Semi-transparent fill
          ctx.fillStyle = color + '22';
          ctx.fillRect(r.left + 1, r.top + 1, r.width - 2, r.height - 2);
          // Label badge
          const lbl = h.label || 'Issue';
          ctx.font = 'bold 11px system-ui,sans-serif';
          const tw = ctx.measureText(lbl).width;
          const bx = Math.max(0, r.left);
          const by = Math.max(0, r.top - 22);
          ctx.fillStyle = color;
          ctx.fillRect(bx, by, tw + 12, 20);
          ctx.fillStyle = '#FFFFFF';
          ctx.fillText(lbl, bx + 6, by + 14);
        });
      });
    }, highlights);
  }

  const ss = await page.screenshot({ type: 'jpeg', quality: 60, fullPage: false });

  // Remove overlay
  await page.evaluate(() => {
    const c = document.getElementById('__levi_overlay__');
    if (c) c.remove();
  });

  return ss ? ss.toString('base64') : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// UNIVERSAL CHECKS — run on every site
// ─────────────────────────────────────────────────────────────────────────────
async function runUniversalChecks(page, url) {
  const results = [];
  const push = (name, pass, detail = '', url_ = '') => results.push({ name, pass, detail, url: url_ });

  const u = await page.evaluate(() => {
    const brokenImgs = [...document.querySelectorAll('img[src]')].filter(img =>
      img.complete && img.naturalWidth === 0 && img.src && !img.src.startsWith('data:')
    ).map(img => img.src.replace(/.*\//, '').slice(0, 40));

    const logo = !!(
      document.querySelector('img.custom-logo, .site-logo img, header img[alt*="logo" i], img[class*="logo"], img[id*="logo"], .logo img, .navbar-brand img, [class*="brand"] img, header svg')
    );

    const navLinks = [...document.querySelectorAll('nav a, header a, [class*="navbar"] a, [class*="nav"] a')].filter(a => a.href && a.offsetParent);
    const brokenNavLinks = navLinks.filter(a => !a.href || a.href.endsWith('#') || a.href.endsWith('#0'));

    const footer = !!(document.querySelector('footer, .site-footer, #footer, [class*="footer"]'));
    const footerLinks = document.querySelectorAll('footer a, .site-footer a').length;

    const h1Count = document.querySelectorAll('h1').length;
    const h1Text = document.querySelector('h1')?.innerText?.trim().slice(0, 60) || '';
    const hasMetaDesc = !!document.querySelector('meta[name="description"][content]');
    const hasMeta = !!document.querySelector('meta[name="viewport"]');

    const hasButtons = document.querySelectorAll('button:not([disabled]), a.button, a.btn, [class*="btn-"], [class*="button-"]').length;

    // Contrast/visibility — look for white-on-white or invisible text in nav
    const bodyBg = window.getComputedStyle(document.body).backgroundColor;

    return {
      title: document.title,
      hasContent: (document.body?.innerText?.trim().length || 0) > 100,
      brokenImgs, logo, navLinks: navLinks.length, brokenNavLinks: brokenNavLinks.length,
      footer, footerLinks, h1Count, h1Text, hasMetaDesc, hasMeta,
      hasButtons, isHttps: window.location.protocol === 'https:',
      bodyBg,
    };
  });

  push('Page loads with content', u.hasContent, u.title || 'No title');
  push('Secure (HTTPS)', u.isHttps, u.isHttps ? 'Secure connection' : 'WARNING: Not HTTPS — browsers show "Not Secure"');
  push('Logo visible in header', u.logo, u.logo ? 'Logo found' : 'No logo detected in header — check selector');
  push('No broken images', u.brokenImgs.length === 0,
    u.brokenImgs.length === 0 ? 'All images load correctly' : 'Broken: ' + u.brokenImgs.slice(0, 3).join(', '));
  push('Navigation links present', u.navLinks >= 2, u.navLinks + ' nav links found');
  if (u.brokenNavLinks > 0) {
    push('No broken nav links (#)', false, u.brokenNavLinks + ' nav links point to # (no destination)');
  }
  push('Footer present', u.footer, u.footer ? u.footerLinks + ' links in footer' : 'No footer element found');
  push('Page has H1 heading', u.h1Count > 0,
    u.h1Count > 0 ? '"' + u.h1Text + '"' : 'Missing H1 — bad for SEO');
  if (u.h1Count > 1) {
    push('Only one H1 per page', false, u.h1Count + ' H1 tags found — should be exactly one');
  }
  push('Meta description present', u.hasMetaDesc, u.hasMetaDesc ? 'Found' : 'Missing — important for SEO and link previews');
  push('Viewport meta tag', u.hasMeta, u.hasMeta ? 'Mobile-ready' : 'Missing — page will not scale on mobile');
  if (u.hasButtons) push('Interactive elements present', true, u.hasButtons + ' buttons/CTAs found');

  // Take desktop screenshot with highlights for issues
  const hlDesktop = [];
  if (!u.logo)                hlDesktop.push({ selector: 'header', label: 'Missing logo', color: 'red' });
  if (u.brokenImgs.length > 0) hlDesktop.push({ selector: 'img[src]', label: 'Broken image', color: 'red' });
  if (u.brokenNavLinks > 0)   hlDesktop.push({ selector: 'nav a[href="#"], header a[href="#"]', label: 'Broken nav link', color: 'amber' });

  const ssDesktop = await screenshotWithHighlights(page, hlDesktop);
  if (ssDesktop) results.push({ name: '[Screenshot] Desktop view', screenshot: true, label: 'Desktop screenshot', url, pass: true, screenshot_data: ssDesktop });

  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// PLATFORM-SPECIFIC CHECKS
// ─────────────────────────────────────────────────────────────────────────────
async function runPlatformChecks(page, platform) {
  const results = [];
  const push = (name, pass, detail = '') => results.push({ name, pass, detail });

  if (['wordpress', 'elementor', 'divi', 'gutenberg', 'woocommerce'].includes(platform)) {
    const wp = await page.evaluate(() => ({
      hasAdminBar:  !!document.querySelector('#wpadminbar'),
      hasCaching:   !!(document.querySelector('meta[name*="cache"]') || window.__CLOUDFLARE_WORKERS),
      hasAkismet:   !!document.querySelector('[class*="akismet"]'),
      missingAlt:   [...document.querySelectorAll('img:not([alt])')].filter(i => i.offsetParent !== null).length,
      // Elementor specific
      isElementor:  !!document.querySelector('[data-elementor-type]'),
      elementorBroken: document.querySelectorAll('.elementor-error, .elementor-alert-danger').length,
      // Gutenberg check
      wpBlocks: document.querySelectorAll('[class*="wp-block"]').length,
      // WooCommerce
      isWoo: !!(document.querySelector('.woocommerce') || window.woocommerce_params),
      wooCart: !!document.querySelector('.cart-contents, .woocommerce-cart, a[href*="cart"]'),
      wooShop: !!document.querySelector('.woocommerce-products-header, .products'),
    }));
    if (wp.missingAlt > 0) push('[WordPress] Images missing alt text', false, wp.missingAlt + ' images without alt — accessibility and SEO issue');
    if (wp.elementorBroken > 0) push('[Elementor] No broken Elementor widgets', false, wp.elementorBroken + ' Elementor error elements detected');
    if (wp.isElementor) push('[Elementor] Elementor page builder detected', true, 'Elementor rendering correctly');
    if (wp.isWoo) {
      push('[WooCommerce] Shop renders correctly', wp.wooShop || wp.wooCart, wp.wooShop ? 'Product grid found' : (wp.wooCart ? 'Cart found' : 'No shop or cart elements'));
    }
  }

  if (platform === 'shopify') {
    const sh = await page.evaluate(() => ({
      hasProducts:  document.querySelectorAll('.product, .product-card, [class*="product__"]').length,
      hasCart:      !!document.querySelector('[class*="cart"], [data-cart]'),
      hasShopNav:   !!document.querySelector('.site-nav, .main-nav, [class*="site-header"]'),
    }));
    push('[Shopify] Products visible', sh.hasProducts > 0, sh.hasProducts + ' products found');
    push('[Shopify] Cart accessible', sh.hasCart, sh.hasCart ? 'Cart element found' : 'No cart element — check theme');
  }

  if (platform === 'wix') {
    const wx = await page.evaluate(() => ({
      hasWixNav:   !!document.querySelector('[id*="SITE_HEADER"],[class*="wix-site-header"]'),
      noIframe:    document.querySelectorAll('iframe[src*="wix"]').length === 0,
    }));
    push('[Wix] Site header loads', wx.hasWixNav, wx.hasWixNav ? 'Header found' : 'Wix header not detected');
  }

  if (platform === 'webflow') {
    const wf = await page.evaluate(() => ({
      hasNav:    !!document.querySelector('[class*="w-nav"], .navbar, [class*="navbar"]'),
      hasCMS:    !!document.querySelector('[class*="w-dyn"]'),
      brokenCMS: document.querySelectorAll('[class*="w-dyn-empty"]').length,
    }));
    push('[Webflow] Navigation renders', wf.hasNav, wf.hasNav ? 'Webflow nav found' : 'Nav not detected');
    if (wf.hasCMS && wf.brokenCMS > 0) push('[Webflow] CMS collections populated', false, wf.brokenCMS + ' empty CMS collection(s) — check data source');
  }

  if (platform === 'react') {
    const rx = await page.evaluate(() => ({
      hasRoot:   !!(document.querySelector('#root, #__next, #app') || window.__NEXT_DATA__),
      isEmpty:   (document.querySelector('#root, #__next')?.children?.length || 1) === 0,
    }));
    push('[React] App hydrates correctly', !rx.isEmpty, rx.isEmpty ? 'React root is empty — likely a hydration error' : 'App rendered');
  }

  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// MOBILE VISUAL TESTING
// Full visual audit at 390px — highlights overlaps, missing logo, overflow, etc.
// ─────────────────────────────────────────────────────────────────────────────
async function runMobileVisualTest(browser, url) {
  const results = [];
  const push = (name, pass, detail = '') => results.push({ name, pass, detail });
  let ctx;

  try {
    ctx = await browser.newContext({
      viewport:  { width: 390, height: 844 },
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      deviceScaleFactor: 3,
      isMobile:  true,
      hasTouch:  true,
    });
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForTimeout(2500);

    // Gather mobile issues with element positions for highlighting
    const issues = await page.evaluate(() => {
      const vw = window.innerWidth; // 390
      const found = [];

      // 1. Horizontal overflow — elements wider than viewport
      const allEls = [...document.querySelectorAll('*')].filter(el => el.offsetParent !== null);
      const overflowEls = allEls.filter(el => {
        const r = el.getBoundingClientRect();
        return r.right > vw + 5 && r.width < vw * 3; // real overflow, not tiny
      }).slice(0, 5);
      overflowEls.forEach(el => {
        const r = el.getBoundingClientRect();
        found.push({ type: 'overflow', rect: { left: r.left, top: r.top, width: r.width, height: r.height, right: r.right, bottom: r.bottom }, tag: el.tagName, cls: el.className?.slice(0, 40) });
      });

      // 2. Logo at mobile width
      const logoEl = document.querySelector('img.custom-logo, .site-logo img, header img[alt*="logo" i], img[class*="logo"], .logo img, .navbar-brand img, header img');
      const logoR = logoEl?.getBoundingClientRect();
      const logoVisible = logoEl && logoR && logoR.width > 0 && logoR.top < 200 && logoR.top > -10;
      if (!logoVisible) found.push({ type: 'missing_logo', rect: null });

      // 3. Text too small to read (< 11px)
      const tinyText = allEls.filter(el => {
        const style = window.getComputedStyle(el);
        const fs = parseFloat(style.fontSize);
        return fs > 0 && fs < 11 && el.innerText?.trim().length > 3;
      }).slice(0, 3);
      tinyText.forEach(el => {
        const r = el.getBoundingClientRect();
        found.push({ type: 'tiny_text', rect: { left: r.left, top: r.top, width: r.width, height: r.height }, fs: window.getComputedStyle(el).fontSize });
      });

      // 4. Overlapping elements — check nav items on top of each other
      const navItems = [...document.querySelectorAll('nav a, .menu a, header a')].filter(el => el.offsetParent !== null).slice(0, 12);
      for (let i = 0; i < navItems.length; i++) {
        for (let j = i + 1; j < navItems.length; j++) {
          const a = navItems[i].getBoundingClientRect();
          const b = navItems[j].getBoundingClientRect();
          const overlaps = !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
          if (overlaps && a.width > 0 && b.width > 0) {
            found.push({ type: 'overlap', rect: { left: Math.min(a.left,b.left), top: Math.min(a.top,b.top), width: Math.max(a.right,b.right)-Math.min(a.left,b.left), height: Math.max(a.bottom,b.bottom)-Math.min(a.top,b.top) } });
            break;
          }
        }
      }

      // 5. Tap target size — buttons < 44px
      const smallBtns = [...document.querySelectorAll('button, a, input[type="submit"]')].filter(el => {
        if (!el.offsetParent) return false;
        const r = el.getBoundingClientRect();
        return r.width > 5 && (r.height < 36 || r.width < 36);
      }).slice(0, 5);
      smallBtns.forEach(el => {
        const r = el.getBoundingClientRect();
        found.push({ type: 'small_tap', rect: { left: r.left, top: r.top, width: r.width, height: r.height }, text: el.innerText?.trim().slice(0, 20) });
      });

      // 6. Horizontal scroll bar visible
      const hasHorizScroll = document.documentElement.scrollWidth > vw + 5;

      return { issues: found, hasHorizScroll, logoVisible, vw, overflowCount: overflowEls.length };
    });

    // Build highlights from issues
    const highlights = [];
    issues.issues.forEach(iss => {
      if (iss.type === 'overflow')     highlights.push({ rect: iss.rect, label: 'Overflows viewport', color: 'red' });
      if (iss.type === 'tiny_text')    highlights.push({ rect: iss.rect, label: 'Text too small ('+iss.fs+')', color: 'amber' });
      if (iss.type === 'overlap')      highlights.push({ rect: iss.rect, label: 'Elements overlap', color: 'red' });
      if (iss.type === 'small_tap')    highlights.push({ rect: iss.rect, label: 'Tap target too small', color: 'amber' });
    });
    if (!issues.logoVisible) highlights.push({ selector: 'header', label: 'Logo missing at mobile', color: 'red' });

    // Take mobile screenshot WITH visual highlights
    const ssMobile = await screenshotWithHighlights(page, highlights);

    // Add issue checks to results
    push('[Mobile] No horizontal overflow', issues.overflowCount === 0,
      issues.overflowCount === 0 ? 'All elements fit within 390px' : 'BUG: ' + issues.overflowCount + ' element(s) overflow viewport — causes horizontal scrollbar');
    push('[Mobile] No horizontal scroll', !issues.hasHorizScroll,
      issues.hasHorizScroll ? 'BUG: Page is wider than viewport — users have to scroll sideways' : 'Correct width');
    push('[Mobile] Logo visible in header', issues.logoVisible,
      issues.logoVisible ? 'Logo present at 390px' : 'Logo not found at mobile width — check responsive CSS');

    const overlapIssues = issues.issues.filter(i => i.type === 'overlap');
    if (overlapIssues.length > 0) {
      push('[Mobile] No overlapping nav elements', false, overlapIssues.length + ' nav item overlap(s) detected — menu may be broken on mobile');
    } else {
      push('[Mobile] Navigation items do not overlap', true, 'All nav items correctly spaced');
    }

    const tinyTextIssues = issues.issues.filter(i => i.type === 'tiny_text');
    if (tinyTextIssues.length > 0) {
      push('[Mobile] Text readable size', false, tinyTextIssues.length + ' element(s) with text smaller than 11px — may be unreadable on mobile');
    } else {
      push('[Mobile] Text readable size', true, 'All text ≥ 11px');
    }

    const smallTapIssues = issues.issues.filter(i => i.type === 'small_tap');
    if (smallTapIssues.length > 0) {
      push('[Mobile] Tap targets minimum size', false, smallTapIssues.length + ' button(s)/link(s) below 36px — hard to tap on touchscreen');
    } else {
      push('[Mobile] Tap targets minimum size', true, 'Buttons/links all tap-friendly');
    }

    // Attach the annotated screenshot to results
    if (ssMobile) {
      results.push({
        name: '[Screenshot] Mobile view (390px) — highlighted issues',
        screenshot: true,
        label: 'Mobile screenshot — ' + highlights.length + ' issue' + (highlights.length !== 1 ? 's' : '') + ' highlighted',
        url,
        pass: highlights.length === 0,
        screenshot_data: ssMobile,
        isMobile: true,
        highlightCount: highlights.length,
      });
    }

    await ctx.close();
  } catch (e) {
    push('[Mobile] Mobile check completed', false, e.message.slice(0, 80));
    if (ctx) await ctx.close().catch(() => {});
  }

  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// FIREBASE
// ─────────────────────────────────────────────────────────────────────────────
async function saveToFirebase(path, data) {
  // Strip base64 screenshot data before saving to keep Firebase lean
  // Store screenshots separately or inline — depends on size
  const res = await fetch(`${FIREBASE_URL}/${path}.json`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Firebase ${res.status}: ${await res.text()}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────
(async () => {
  const today     = new Date().toISOString().slice(0, 10);
  const startTime = Date.now();

  log(`\n${'═'.repeat(56)}`, 'section');
  log(`  Levi — Universal Site Audit`, 'section');
  log(`  powered by leverage.it`, 'section');
  log(`  URL: ${CUSTOM_URL}`, 'section');
  log(`${'═'.repeat(56)}`, 'section');

  const browser = await chromium.launch({ headless: true });
  const result  = {
    id: SITE_NAMESPACE, name: DISPLAY_NAME, url: CUSTOM_URL,
    siteType: 'unknown', platform: 'unknown',
    runAt: new Date().toISOString(),
    status: 'pass', uiChecks: [], evidence: [], majorFailures: [],
    clientId: CLIENT_ID || null,
    poweredBy: 'leverage.it',
  };

  try {
    const ctx = await browser.newContext({
      viewport:  { width: 1440, height: 900 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
      locale:    'en-US',
      ignoreHTTPSErrors: true,
    });
    const page = await ctx.newPage();

    // ── Load ─────────────────────────────────────────────────────────────────
    log(`Loading ${CUSTOM_URL}…`);
    const resp   = await page.goto(CUSTOM_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const status = resp?.status() || 0;
    result.httpStatus = status;
    log(`HTTP ${status}`, status < 400 ? 'pass' : 'fail');
    if (status >= 400) {
      result.status = 'fail';
      result.majorFailures.push('HTTP ' + status + ' — site returned error');
    }

    await page.waitForTimeout(2500);

    // ── Detect platform ───────────────────────────────────────────────────────
    const platform = await detectPlatform(page);
    result.siteType = platform; result.platform = platform;
    log(`\nPlatform: ${platform}`, 'section');

    // ── Homepage screenshot (clean — before any issue overlays) ──────────────
    const ssClean = await page.screenshot({ type: 'jpeg', quality: 60, fullPage: false });
    if (ssClean) {
      result.evidence.push({
        label: 'Desktop — homepage',
        url: CUSTOM_URL,
        screenshot: ssClean.toString('base64'),
        type: 'desktop',
        ts: new Date().toISOString(),
      });
    }

    // ── Universal checks ──────────────────────────────────────────────────────
    log('\n── Universal checks ──', 'section');
    const universal = await runUniversalChecks(page, CUSTOM_URL);
    universal.forEach(c => {
      if (!c.screenshot) log(`  ${c.pass ? '✓' : '✗'} ${c.name}${c.detail ? ' ('+c.detail+')' : ''}`, c.pass ? 'pass' : 'fail');
      else {
        // Move screenshot from checks to evidence
        result.evidence.push({ label: c.label, url: c.url, screenshot: c.screenshot_data, type: 'desktop-annotated' });
      }
    });
    result.uiChecks.push(...universal.filter(c => !c.screenshot));

    // ── Platform checks ───────────────────────────────────────────────────────
    log(`\n── ${platform} checks ──`, 'section');
    const platChecks = await runPlatformChecks(page, platform);
    platChecks.forEach(c => log(`  ${c.pass ? '✓' : '✗'} ${c.name}${c.detail ? ' ('+c.detail+')' : ''}`, c.pass ? 'pass' : 'fail'));
    result.uiChecks.push(...platChecks);

    await ctx.close();

    // ── Mobile visual test ────────────────────────────────────────────────────
    log('\n── Mobile visual tests (390px) ──', 'section');
    const mobileChecks = await runMobileVisualTest(browser, CUSTOM_URL);
    mobileChecks.forEach(c => {
      if (!c.screenshot) {
        log(`  ${c.pass ? '✓' : '✗'} ${c.name}${c.detail ? ' ('+c.detail+')' : ''}`, c.pass ? 'pass' : 'fail');
        result.uiChecks.push(c);
      } else {
        // Mobile screenshot → evidence
        result.evidence.push({
          label: c.label,
          url: c.url,
          screenshot: c.screenshot_data,
          type: 'mobile-annotated',
          highlightCount: c.highlightCount,
        });
        log(`  📱 Mobile screenshot captured — ${c.highlightCount} issue(s) highlighted`, c.pass ? 'pass' : 'warn');
      }
    });

    // ── Final status ──────────────────────────────────────────────────────────
    const failures = result.uiChecks.filter(c => !c.pass);
    if (failures.length > 0) {
      result.status = 'fail';
      result.majorFailures.push(...failures.slice(0, 5).map(c => c.name));
    }

    result.durationMs  = Date.now() - startTime;
    result.checksTotal = result.uiChecks.length;
    result.checksPassed = result.uiChecks.filter(c => c.pass).length;

    log(`\n${'═'.repeat(56)}`, 'section');
    log(`  ${result.status === 'pass' ? '✅' : '❌'} ${DISPLAY_NAME} — ${result.status.toUpperCase()}`, result.status === 'pass' ? 'pass' : 'fail');
    log(`  ${result.checksPassed}/${result.checksTotal} checks passed · ${(result.durationMs/1000).toFixed(1)}s · ${result.evidence.length} screenshots`, 'section');
    log(`${'═'.repeat(56)}`, 'section');

    // ── Save to Firebase ──────────────────────────────────────────────────────
    const basePath = CLIENT_ID
      ? `customResults/${CLIENT_ID}/${today}/${SITE_NAMESPACE}`
      : `customResults/${today}/${SITE_NAMESPACE}`;

    await saveToFirebase(basePath, result);
    log(`\nSaved to Firebase: ${basePath}`);

    // Update latest pointer
    const latestPath = CLIENT_ID ? `customLatest/${CLIENT_ID}` : 'customLatest';
    const existing = await fetch(`${FIREBASE_URL}/${latestPath}.json`).then(r => r.json()).catch(() => ({}));
    await saveToFirebase(latestPath, { ...(existing || {}), [SITE_NAMESPACE]: today });

  } catch (e) {
    log(`Fatal error: ${e.message}`, 'fail');
    result.status = 'fail';
    result.majorFailures.push('Fatal: ' + e.message.slice(0, 60));
    result.durationMs = Date.now() - startTime;
    const basePath = CLIENT_ID
      ? `customResults/${CLIENT_ID}/${today}/${SITE_NAMESPACE}`
      : `customResults/${today}/${SITE_NAMESPACE}`;
    await saveToFirebase(basePath, result).catch(() => {});
  } finally {
    await browser.close();
  }
})();
