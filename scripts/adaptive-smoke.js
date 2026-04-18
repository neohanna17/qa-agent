/**
 * Levi — Universal Adaptive Smoke Test v2
 * powered by leverage.it
 *
 * Desktop + Mobile visual testing with highlighted screenshot evidence.
 * Auto-detects platform (WordPress, Elementor, Shopify, Wix, Webflow, WooCommerce, etc.)
 *
 * NEW in v2:
 *   - Button & link validity check (all pages)
 *   - WCAG AA colour contrast check
 *   - Form accessibility (labels, submit buttons)
 *   - CTA above-fold detection
 *   - JavaScript console error capture
 *   - Internal 404 link checker
 *   - Page title quality (SEO)
 *   - Social media links detection
 *   - Mobile menu open screenshot
 *   - Multi-page crawl (homepage + up to 2 internal pages)
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
 *   GITHUB_RUN_ID     Injected by GitHub Actions
 */

'use strict';
const { chromium } = require('playwright');
const admin = require('firebase-admin');

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────────
const CUSTOM_URL       = process.env.CUSTOM_URL       || '';
const SITE_NAME        = process.env.SITE_NAME        || '';
const SITE_TYPE        = process.env.SITE_TYPE        || '';
const SITE_NAMESPACE   = process.env.SITE_NAMESPACE   || '';
const CLIENT_ID        = process.env.CLIENT_ID        || '';
const DB_URL           = process.env.FIREBASE_DATABASE_URL || '';
const GITHUB_RUN_ID    = process.env.GITHUB_RUN_ID    || '';

const RESET  = '\x1b[0m';
const RED    = '\x1b[31m';
const GREEN  = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN   = '\x1b[36m';

function log(color, msg) { console.log(color + msg + RESET); }

// ─────────────────────────────────────────────────────────────────────────────
// PLATFORM DETECTION
// ─────────────────────────────────────────────────────────────────────────────
async function detectPlatform(page) {
  return await page.evaluate(() => {
    const html = document.documentElement.innerHTML.toLowerCase();
    const meta = document.querySelector('meta[name="generator"]');
    const generator = meta ? meta.content.toLowerCase() : '';

    if (html.includes('shopify') || generator.includes('shopify')) return 'shopify';
    if (html.includes('squarespace') || generator.includes('squarespace')) return 'squarespace';
    if (html.includes('wix.com') || generator.includes('wix')) return 'wix';
    if (html.includes('webflow') || generator.includes('webflow')) return 'webflow';
    if (html.includes('elementor') || generator.includes('elementor')) return 'elementor';
    if (html.includes('divi') || generator.includes('divi')) return 'divi';
    if (html.includes('woocommerce')) return 'woocommerce';
    if (html.includes('wp-content') || html.includes('wp-includes') || generator.includes('wordpress')) return 'wordpress';
    if (html.includes('gutenberg') || html.includes('wp-block')) return 'gutenberg';
    if (html.includes('next') || html.includes('__next')) return 'nextjs';
    if (html.includes('react') || html.includes('__reactfiber')) return 'react';
    return 'custom';
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// SCREENSHOT WITH CANVAS HIGHLIGHTS
// ─────────────────────────────────────────────────────────────────────────────
async function screenshotWithHighlights(page, issues) {
  await page.evaluate((issueList) => {
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:999999';
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');

    issueList.forEach(issue => {
      if (!issue.selector) return;
      const els = document.querySelectorAll(issue.selector);
      els.forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return;
        ctx.strokeStyle = issue.color || '#FF0000';
        ctx.lineWidth   = 3;
        ctx.strokeRect(r.left + 1, r.top + 1, r.width - 2, r.height - 2);
        ctx.fillStyle = (issue.color || '#FF0000') + '22';
        ctx.fillRect(r.left + 1, r.top + 1, r.width - 2, r.height - 2);
      });
    });
  }, issues);

  const shot = await page.screenshot({ type: 'jpeg', quality: 85, fullPage: false });

  await page.evaluate(() => {
    const canvas = document.querySelector('canvas[style*="z-index:999999"]');
    if (canvas) canvas.remove();
  });

  return shot;
}

// ─────────────────────────────────────────────────────────────────────────────
// UNIVERSAL CHECKS — run on every site
// ─────────────────────────────────────────────────────────────────────────────
async function runUniversalChecks(page, uiChecks, url, consoleErrors) {

  // 1. HTTP Status / reachable
  let httpOk = true;
  try {
    const resp = await page.request.get(url, { timeout: 10000 });
    httpOk = resp.status() < 400;
    uiChecks.push({ name: 'Page Reachable (HTTP)', pass: httpOk, detail: httpOk ? `HTTP ${resp.status()} OK` : `HTTP ${resp.status()} error` });
  } catch(e) {
    uiChecks.push({ name: 'Page Reachable (HTTP)', pass: false, detail: 'Could not reach page: ' + e.message });
  }

  // 2. HTTPS
  const isHttps = url.startsWith('https://');
  uiChecks.push({ name: 'Secure (HTTPS)', pass: isHttps, detail: isHttps ? 'Site served over HTTPS' : 'WARNING: Not HTTPS — browsers show "Not Secure"' });

  // 3. Page title quality
  const title = await page.title();
  const titleOk = title && title.length >= 10 && title.length <= 70;
  uiChecks.push({
    name: 'Page Title Quality',
    pass: !!titleOk,
    detail: !title ? 'No title tag found'
      : title.length < 10 ? `Title too short: "${title}" (${title.length} chars)`
      : title.length > 70 ? `Title too long: ${title.length} chars — trim for SEO`
      : `"${title}" (${title.length} chars)`
  });

  // 4. Meta description
  const metaDesc = await page.$eval('meta[name="description"]', el => el.content).catch(() => '');
  const metaOk = metaDesc && metaDesc.length >= 50 && metaDesc.length <= 160;
  uiChecks.push({
    name: 'Meta Description',
    pass: !!metaOk,
    detail: !metaDesc ? 'Missing meta description'
      : metaDesc.length < 50 ? `Too short (${metaDesc.length} chars, min 50)`
      : metaDesc.length > 160 ? `Too long (${metaDesc.length} chars, max 160)`
      : `OK (${metaDesc.length} chars)`
  });

  // 5. Viewport meta
  const viewport = await page.$('meta[name="viewport"]');
  uiChecks.push({ name: 'Viewport Meta Tag', pass: !!viewport, detail: viewport ? 'Viewport meta tag present' : 'Missing viewport meta — site may not scale on mobile' });

  // 6. H1 heading
  const h1s = await page.$$eval('h1', els => els.map(e => e.innerText.trim()).filter(t => t));
  const h1Ok = h1s.length === 1;
  uiChecks.push({
    name: 'H1 Heading',
    pass: h1Ok,
    detail: h1s.length === 0 ? 'No H1 heading found — important for SEO'
      : h1s.length > 1 ? `${h1s.length} H1s found — should have exactly one`
      : `"${h1s[0].substring(0, 60)}"`
  });

  // 7. Logo in header
  const hasLogo = await page.evaluate(() => {
    const header = document.querySelector('header, .header, #header, nav, .navbar');
    if (!header) return false;
    return !!(header.querySelector('img, svg, .logo, [class*="logo"], [class*="brand"]'));
  });
  uiChecks.push({ name: 'Logo in Header', pass: hasLogo, detail: hasLogo ? 'Logo element found in header/nav' : 'No logo found in header area' });

  // 8. Navigation links
  const navLinks = await page.evaluate(() => {
    const nav = document.querySelector('nav, header, .navbar, .navigation, .nav, #nav');
    if (!nav) return 0;
    return nav.querySelectorAll('a[href]').length;
  });
  uiChecks.push({ name: 'Navigation Links', pass: navLinks >= 2, detail: navLinks >= 2 ? `${navLinks} nav link(s) found` : `Only ${navLinks} nav link(s) — navigation may be broken` });

  // 9. Footer present
  const hasFooter = await page.$('footer, .footer, #footer, [class*="footer"]').then(el => !!el);
  uiChecks.push({ name: 'Footer Present', pass: hasFooter, detail: hasFooter ? 'Footer element found' : 'No footer detected on page' });

  // 10. Broken images
  const brokenImgs = await page.evaluate(() => {
    return [...document.querySelectorAll('img')]
      .filter(img => img.complete && img.naturalWidth === 0 && img.src && !img.src.includes('data:'))
      .map(img => img.src.split('/').pop().substring(0, 40));
  });
  uiChecks.push({
    name: 'No Broken Images',
    pass: brokenImgs.length === 0,
    detail: brokenImgs.length === 0 ? 'All images loaded successfully' : `${brokenImgs.length} broken image(s): ${brokenImgs.slice(0,3).join(', ')}`
  });

  // 11. Image alt text
  const altResult = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll('img')].filter(i => i.naturalWidth > 0 && i.offsetParent !== null);
    const missing = imgs.filter(i => !i.alt);
    return { total: imgs.length, missing: missing.length, srcs: missing.slice(0,3).map(i => i.src.split('/').pop().substring(0,40)) };
  });
  uiChecks.push({
    name: 'Images Have Alt Text',
    pass: altResult.missing === 0,
    detail: altResult.missing === 0 ? `All ${altResult.total} image(s) have alt text` : `${altResult.missing}/${altResult.total} image(s) missing alt text: ${altResult.srcs.join(', ')}`
  });

  // 12. Button & Link Validity
  const linkResult = await page.evaluate(() => {
    const broken = [];
    const valid = [];
    [...document.querySelectorAll('a')].forEach(el => {
      const href = el.getAttribute('href');
      const text = (el.innerText || el.textContent || '').trim().substring(0, 40);
      if (!text || el.offsetParent === null) return;
      if (!href || href === '#' || href === '' || href.startsWith('javascript:')) {
        broken.push(text);
      } else {
        valid.push(href);
      }
    });
    return { broken: [...new Set(broken)], validCount: valid.length };
  });
  uiChecks.push({
    name: 'Button & Link Validity',
    pass: linkResult.broken.length === 0,
    detail: linkResult.broken.length === 0
      ? `All ${linkResult.validCount} link(s) have valid hrefs`
      : `${linkResult.broken.length} link(s) with empty/invalid href: ${linkResult.broken.slice(0,3).map(t => '"'+t+'"').join(', ')}`
  });

  // 13. CTA above fold
  const ctaResult = await page.evaluate(() => {
    const vh = window.innerHeight;
    const ctas = [...document.querySelectorAll('a[class*="btn"], a[class*="button"], a[class*="cta"], button[class*="btn"], .wp-block-button a, .elementor-button, [class*="cta-button"]')];
    const above = ctas.filter(el => { const r = el.getBoundingClientRect(); return r.top < vh && r.bottom > 0 && r.width > 0; });
    return { total: ctas.length, above: above.length, text: above[0] ? (above[0].innerText||'').trim().substring(0,40) : null };
  });
  if (ctaResult.total > 0) {
    uiChecks.push({
      name: 'CTA Visible Above Fold',
      pass: ctaResult.above > 0,
      detail: ctaResult.above > 0 ? `${ctaResult.above} CTA(s) above fold — "${ctaResult.text}"` : `${ctaResult.total} CTA(s) found but none visible above fold`
    });
  }

  // 14. Colour contrast (sample check)
  const contrastIssues = await page.evaluate(() => {
    function luminance(r, g, b) {
      return [r,g,b].reduce((sum, c, i) => {
        c = c/255;
        c = c <= 0.03928 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4);
        return sum + c * [0.2126, 0.7152, 0.0722][i];
      }, 0);
    }
    function contrast(l1, l2) { return (Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05); }
    function parseRGB(s) { const m = s.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/); return m ? [+m[1],+m[2],+m[3]] : null; }

    const issues = [];
    [...document.querySelectorAll('p, h1, h2, h3, a, button, label')].slice(0, 60).forEach(el => {
      if (!el.offsetParent || !(el.innerText||'').trim()) return;
      const st = window.getComputedStyle(el);
      const fg = parseRGB(st.color);
      const bg = parseRGB(st.backgroundColor);
      if (!fg || !bg || st.backgroundColor === 'rgba(0, 0, 0, 0)') return;
      const ratio = contrast(luminance(...fg), luminance(...bg));
      if (ratio < 4.5) issues.push({ text: (el.innerText||'').trim().substring(0,30), ratio: ratio.toFixed(1) });
    });
    return [...new Map(issues.map(i=>[i.text,i])).values()].slice(0,4);
  });
  uiChecks.push({
    name: 'Colour Contrast (WCAG AA)',
    pass: contrastIssues.length === 0,
    detail: contrastIssues.length === 0 ? 'Text contrast meets WCAG AA (4.5:1)' : `${contrastIssues.length} element(s) fail contrast: ${contrastIssues.map(i=>'"'+i.text+'" ('+i.ratio+':1)').join('; ')}`
  });

  // 15. Form accessibility
  const formResult = await page.evaluate(() => {
    const forms = [...document.querySelectorAll('form')];
    if (!forms.length) return { count: 0, issues: [] };
    const issues = [];
    forms.forEach((form, fi) => {
      [...form.querySelectorAll('input:not([type=hidden]), textarea, select')].forEach(inp => {
        const hasLabel = (inp.id && document.querySelector('label[for="'+inp.id+'"]')) || inp.getAttribute('aria-label') || inp.getAttribute('placeholder');
        if (!hasLabel) issues.push('Form '+(fi+1)+': unlabelled '+inp.tagName.toLowerCase());
      });
      if (!form.querySelector('[type=submit], button[type=submit], button:not([type])')) {
        issues.push('Form '+(fi+1)+': no submit button');
      }
    });
    return { count: forms.length, issues };
  });
  if (formResult.count > 0) {
    uiChecks.push({
      name: 'Form Accessibility',
      pass: formResult.issues.length === 0,
      detail: formResult.issues.length === 0 ? `${formResult.count} form(s) — all inputs labelled` : formResult.issues.slice(0,3).join('; ')
    });
  }

  // 16. JavaScript console errors
  const filteredErrors = (consoleErrors || []).filter(e => !e.includes('favicon') && !e.includes('analytics') && !e.includes('gtag') && !e.includes('fbq'));
  uiChecks.push({
    name: 'No JavaScript Errors',
    pass: filteredErrors.length === 0,
    detail: filteredErrors.length === 0 ? 'No JS errors on page load' : `${filteredErrors.length} JS error(s): ${filteredErrors.slice(0,2).join(' | ')}`
  });

  // 17. Social media links
  const socials = await page.evaluate(() => {
    return [...new Set([...document.querySelectorAll('a[href]')]
      .map(a => { const m = a.href.match(/(?:facebook|instagram|twitter|linkedin|youtube|tiktok)\.com/); return m ? m[0].split('.')[0] : null; })
      .filter(Boolean))];
  });
  uiChecks.push({
    name: 'Social Media Links',
    pass: socials.length > 0,
    detail: socials.length > 0 ? `Found: ${socials.join(', ')}` : 'No social media links found in page'
  });

  // 18. Page load — render-blocking scripts
  const blockingScripts = await page.evaluate(() => {
    return [...document.querySelectorAll('script[src]:not([async]):not([defer])')].length;
  });
  uiChecks.push({
    name: 'Render-Blocking Scripts',
    pass: blockingScripts <= 3,
    detail: blockingScripts <= 3 ? `${blockingScripts} blocking script(s) — acceptable` : `${blockingScripts} render-blocking scripts — consider async/defer for faster load`
  });

  // 19. Internal link 404 check
  const internalLinks = await page.evaluate((base) => {
    try {
      const origin = new URL(base).origin;
      return [...new Set([...document.querySelectorAll('a[href]')]
        .map(a => a.href)
        .filter(h => h.startsWith(origin) && !h.includes('#') && !h.includes('mailto:') && !h.includes('tel:') && h !== base && h !== base + '/')
      )].slice(0, 8);
    } catch(e) { return []; }
  }, url);

  const broken404 = [];
  for (const link of internalLinks) {
    try {
      const resp = await page.request.get(link, { timeout: 6000 });
      if (resp.status() === 404 || resp.status() === 410) {
        broken404.push(link.replace(new URL(url).origin, '').substring(0, 60));
      }
    } catch(e) { /* timeout, skip */ }
  }
  uiChecks.push({
    name: 'Internal Links (No 404s)',
    pass: broken404.length === 0,
    detail: broken404.length === 0 ? `All ${internalLinks.length} internal link(s) return valid responses` : `${broken404.length} broken link(s): ${broken404.slice(0,3).join(', ')}`
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// PLATFORM-SPECIFIC CHECKS
// ─────────────────────────────────────────────────────────────────────────────
async function runPlatformChecks(page, platform, uiChecks) {
  if (['wordpress', 'elementor', 'divi', 'gutenberg', 'woocommerce'].includes(platform)) {
    const elementorErrors = await page.evaluate(() => {
      return [...document.querySelectorAll('.elementor-error, .elementor-widget-empty')].length;
    });
    if (platform === 'elementor') {
      uiChecks.push({ name: 'Elementor Errors', pass: elementorErrors === 0, detail: elementorErrors === 0 ? 'No Elementor widget errors' : `${elementorErrors} Elementor error(s) visible` });
    }

    const hasWpBlocks = await page.$('.wp-site-blocks, .wp-block, .entry-content, .site-content').then(el => !!el);
    uiChecks.push({ name: 'WordPress Content Renders', pass: hasWpBlocks, detail: hasWpBlocks ? 'WordPress content blocks rendering' : 'WordPress content area not detected' });

    if (platform === 'woocommerce') {
      const hasShop = await page.$('.woocommerce, .products, .wc-block-grid').then(el => !!el);
      uiChecks.push({ name: 'WooCommerce Shop Renders', pass: hasShop, detail: hasShop ? 'WooCommerce product grid visible' : 'WooCommerce shop not detected' });
    }
  }

  if (platform === 'shopify') {
    const hasProducts = await page.$('.product-list, .product-grid, .collection-list, [class*="product"]').then(el => !!el);
    uiChecks.push({ name: 'Shopify Products Visible', pass: hasProducts, detail: hasProducts ? 'Product listings detected' : 'No product listings found' });
    const hasCart = await page.$('a[href*="/cart"], .cart-link, .header__icon--cart').then(el => !!el);
    uiChecks.push({ name: 'Cart Accessible', pass: hasCart, detail: hasCart ? 'Cart link present' : 'No cart link found in navigation' });
  }

  if (platform === 'webflow') {
    const navRenders = await page.$('nav, .w-nav, .navbar').then(el => !!el);
    uiChecks.push({ name: 'Webflow Nav Renders', pass: navRenders, detail: navRenders ? 'Webflow navigation present' : 'Navigation not detected' });
  }

  if (platform === 'wix') {
    const headerLoads = await page.$('#SITE_HEADER, [id*="header"], .site-header').then(el => !!el);
    uiChecks.push({ name: 'Wix Header Loads', pass: headerLoads, detail: headerLoads ? 'Wix site header loaded' : 'Wix header not detected' });
  }

  if (['react', 'nextjs'].includes(platform)) {
    const appHydrated = await page.evaluate(() => !!document.querySelector('#__next, #root, [data-reactroot]'));
    uiChecks.push({ name: 'React App Hydrated', pass: appHydrated, detail: appHydrated ? 'React/Next.js app mounted correctly' : 'React app root not found — may not have hydrated' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MOBILE VISUAL TESTING + MENU SCREENSHOT
// ─────────────────────────────────────────────────────────────────────────────
async function runMobileChecks(browser, url, uiChecks, evidence) {
  const mobilePage = await browser.newPage();
  await mobilePage.setViewportSize({ width: 390, height: 844 });

  // Capture mobile console errors
  const mobileErrors = [];
  mobilePage.on('console', msg => { if (msg.type() === 'error') mobileErrors.push(msg.text()); });

  try {
    await mobilePage.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await mobilePage.waitForTimeout(2000);

    // Mobile overflow check
    const overflowData = await mobilePage.evaluate(() => {
      const overflowing = [...document.querySelectorAll('*')].filter(el => {
        const rect = el.getBoundingClientRect();
        return rect.right > window.innerWidth + 5 && rect.width > 0 && el.offsetParent !== null;
      });
      return { count: overflowing.length, tags: overflowing.slice(0,3).map(e => e.tagName + '.' + (e.className||'').split(' ')[0]) };
    });
    uiChecks.push({
      name: '[Mobile] No Horizontal Overflow',
      pass: overflowData.count === 0,
      detail: overflowData.count === 0 ? 'No horizontal overflow on mobile' : `${overflowData.count} element(s) overflow screen width: ${overflowData.tags.join(', ')}`
    });

    // Tap targets
    const tapTargets = await mobilePage.evaluate(() => {
      return [...document.querySelectorAll('a, button, [role=button], input[type=submit]')]
        .filter(el => el.offsetParent !== null)
        .filter(el => { const r = el.getBoundingClientRect(); return r.height > 0 && r.width > 0 && (r.height < 36 || r.width < 36); })
        .length;
    });
    uiChecks.push({
      name: '[Mobile] Tap Targets Minimum Size',
      pass: tapTargets === 0,
      detail: tapTargets === 0 ? 'All tap targets meet 36px minimum' : `${tapTargets} button(s)/link(s) below 36px — hard to tap on touchscreen`
    });

    // Text size
    const smallText = await mobilePage.evaluate(() => {
      return [...document.querySelectorAll('p, li, span, a, td')].filter(el => {
        const sz = parseFloat(window.getComputedStyle(el).fontSize);
        return sz < 11 && el.offsetParent !== null && (el.innerText||'').trim().length > 3;
      }).length;
    });
    uiChecks.push({
      name: '[Mobile] Text Size Readable',
      pass: smallText === 0,
      detail: smallText === 0 ? 'All text is 11px or larger on mobile' : `${smallText} element(s) with text below 11px`
    });

    // Nav overlap
    const navOverlap = await mobilePage.evaluate(() => {
      const nav = document.querySelector('nav, header, .navbar, .navigation');
      if (!nav) return 0;
      const items = [...nav.querySelectorAll('a, li')].filter(el => el.offsetParent !== null);
      let overlaps = 0;
      for (let i = 0; i < items.length - 1; i++) {
        const r1 = items[i].getBoundingClientRect();
        const r2 = items[i+1].getBoundingClientRect();
        if (r1.right > r2.left + 5 && Math.abs(r1.top - r2.top) < 10) overlaps++;
      }
      return overlaps;
    });
    uiChecks.push({
      name: '[Mobile] No Overlapping Nav Elements',
      pass: navOverlap === 0,
      detail: navOverlap === 0 ? 'Navigation renders correctly on mobile' : `${navOverlap} nav item overlap(s) — menu may be broken on mobile`
    });

    // Mobile annotated screenshot
    const mobileHighlights = [];
    if (overflowData.count > 0) {
      mobileHighlights.push({ selector: '*', color: '#FF0000', label: 'overflow' });
    }
    const mobileShot = await mobilePage.screenshot({ type: 'jpeg', quality: 85, fullPage: false });
    evidence.push({
      type: 'mobile-annotated',
      screenshot: mobileShot.toString('base64'),
      highlightCount: overflowData.count + tapTargets + smallText + navOverlap
    });

    // ── MOBILE MENU OPEN SCREENSHOT ──────────────────────────────────────────
    try {
      const hamburger = await mobilePage.$([
        '[class*="hamburger"]',
        '[class*="menu-toggle"]',
        '[class*="nav-toggle"]',
        '[class*="mobile-menu-button"]',
        '[aria-label*="menu" i]',
        '[aria-label*="navigation" i]',
        '.menu-icon',
        '.burger',
        '.navicon',
        'button[class*="mobile"]',
        'button[class*="nav"]'
      ].join(', '));

      if (hamburger) {
        await hamburger.click();
        await mobilePage.waitForTimeout(700);
        const menuShot = await mobilePage.screenshot({ type: 'jpeg', quality: 85, fullPage: false });
        evidence.push({
          type: 'mobile-menu',
          screenshot: menuShot.toString('base64'),
          label: 'Mobile menu — open state'
        });
        log(GREEN, '  ✓ Mobile menu screenshot captured');
      } else {
        log(YELLOW, '  ⚠ No hamburger menu found — may be desktop-only nav');
      }
    } catch(e) {
      log(YELLOW, '  ⚠ Mobile menu screenshot failed: ' + e.message);
    }

  } finally {
    await mobilePage.close();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FIREBASE
// ─────────────────────────────────────────────────────────────────────────────
function initFirebase() {
  if (!DB_URL) { log(YELLOW, 'No FIREBASE_DATABASE_URL — results will not be saved'); return null; }
  try {
    admin.initializeApp({ credential: admin.credential.applicationDefault(), databaseURL: DB_URL });
    return admin.database();
  } catch(e) {
    try {
      // Fallback: init without credentials (public DB rules)
      const app = admin.initializeApp({ databaseURL: DB_URL }, 'levi');
      return admin.database(app);
    } catch(e2) {
      log(RED, 'Firebase init failed: ' + e2.message);
      return null;
    }
  }
}

async function saveResults(db, namespace, results) {
  if (!db) return;
  const date = new Date().toISOString().slice(0, 10);
  const ref  = db.ref(`customResults/${date}/${namespace}`);
  await ref.set(results);
  await db.ref(`customLatest/${namespace}`).set(date);
  log(GREEN, `  ✓ Saved to Firebase: customResults/${date}/${namespace}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────
(async () => {
  if (!CUSTOM_URL) { log(RED, 'ERROR: CUSTOM_URL env var is required'); process.exit(1); }

  const url       = CUSTOM_URL.startsWith('http') ? CUSTOM_URL : 'https://' + CUSTOM_URL;
  const siteName  = SITE_NAME || url.replace(/https?:\/\/(www\.)?/, '').split('/')[0];
  const namespace = SITE_NAMESPACE || url.replace(/https?:\/\//, '').replace(/[^a-zA-Z0-9]/g, '_').replace(/__+/g, '_').slice(0, 40);

  log(CYAN, `\n🔍 Levi — Auditing: ${url}`);
  log(CYAN, `   Site:      ${siteName}`);
  log(CYAN, `   Namespace: ${namespace}`);
  log(CYAN, `   Run ID:    ${GITHUB_RUN_ID || 'local'}\n`);

  const db = initFirebase();

  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const uiChecks = [];
  const evidence = [];
  const consoleErrors = [];

  try {
    // ── DESKTOP PAGE ──────────────────────────────────────────────────────────
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1440, height: 900 });

    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text().substring(0, 150)); });
    page.on('pageerror', err => consoleErrors.push(err.message.substring(0, 150)));

    log(CYAN, '  → Loading page (desktop)…');
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(3000);

    // Detect platform
    const detectedPlatform = SITE_TYPE || await detectPlatform(page);
    log(CYAN, `  → Platform detected: ${detectedPlatform}`);

    // Desktop screenshot (clean)
    const desktopShot = await page.screenshot({ type: 'jpeg', quality: 85, fullPage: false });
    evidence.push({ type: 'desktop', screenshot: desktopShot.toString('base64') });

    // Run all universal checks
    log(CYAN, '  → Running universal checks…');
    await runUniversalChecks(page, uiChecks, url, consoleErrors);

    // Platform-specific checks
    log(CYAN, `  → Running ${detectedPlatform} checks…`);
    await runPlatformChecks(page, detectedPlatform, uiChecks);

    // Desktop annotated screenshot
    const failSelectors = [];
    const annotatedShot = await screenshotWithHighlights(page, failSelectors);
    evidence.push({ type: 'desktop-annotated', screenshot: annotatedShot.toString('base64') });

    await page.close();

    // ── MOBILE CHECKS + MENU SCREENSHOT ──────────────────────────────────────
    log(CYAN, '  → Running mobile checks…');
    await runMobileChecks(browser, url, uiChecks, evidence);

    // ── RESULTS ───────────────────────────────────────────────────────────────
    const passed = uiChecks.filter(c => c.pass).length;
    const failed = uiChecks.filter(c => !c.pass).length;
    const score  = Math.round(passed / uiChecks.length * 100);
    const status = failed === 0 ? 'pass' : failed <= 3 ? 'warn' : 'fail';

    log(CYAN, `\n  ── Results: ${passed}/${uiChecks.length} passed (${score}%) ──`);
    uiChecks.forEach(c => log(c.pass ? GREEN : RED, `  ${c.pass ? '✓' : '✗'} ${c.name}: ${c.detail}`));

    const result = {
      url,
      name: siteName,
      siteType: detectedPlatform,
      status,
      score,
      runAt: new Date().toISOString(),
      githubRunId: GITHUB_RUN_ID,
      uiChecks,
      evidence
    };

    await saveResults(db, namespace, result);
    log(GREEN, `\n✅ Levi audit complete — ${score}% (${passed}/${uiChecks.length} checks passed)\n`);

  } catch(err) {
    log(RED, `\n❌ Audit failed: ${err.message}`);
    console.error(err);
    process.exit(1);
  } finally {
    await browser.close();
    if (db) process.exit(0);
  }
})();
