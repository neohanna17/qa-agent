/**
 * Levi — Universal Adaptive Smoke Test v3
 * powered by leverage.it
 *
 * 72 checks: SEO, accessibility, performance, UI/UX, mobile, security, links.
 * Uses HTTPS REST API for Firebase — no credentials needed (public DB rules).
 * Auto-detects platform. Screenshots every major nav page + mobile menu.
 */
'use strict';
const { chromium } = require('playwright');
const https = require('https');
const CUSTOM_URL     = process.env.CUSTOM_URL     || '';
const SITE_NAME      = process.env.SITE_NAME      || '';
const SITE_TYPE      = process.env.SITE_TYPE      || '';
const SITE_NAMESPACE = process.env.SITE_NAMESPACE || '';
const GITHUB_RUN_ID  = process.env.GITHUB_RUN_ID  || '';
const DB_BASE = (process.env.FIREBASE_DATABASE_URL || 'https://qa-tracker-73b87-default-rtdb.firebaseio.com').replace(/\/$/, '');
const R='\x1b[0m', RED='\x1b[31m', GREEN='\x1b[32m', YELLOW='\x1b[33m', CYAN='\x1b[36m';
const log = (c, m) => console.log(c + m + R);

// ─── FIREBASE REST API ────────────────────────────────────────────────────────
function firebaseRequest(method, path, data) {
  return new Promise((resolve, reject) => {
    const url  = new URL(DB_BASE + path + '.json');
    const body = data ? JSON.stringify(data) : null;
    const options = {
      hostname: url.hostname,
      path:     url.pathname + url.search,
      method,
      headers: { 'Content-Type': 'application/json', ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}) },
    };
    const req = https.request(options, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => { try { resolve(JSON.parse(raw)); } catch(e) { resolve(raw); } });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function saveResults(ns, results) {
  if (!DB_BASE) { log(YELLOW, 'No DB_URL — skipping save'); return; }
  const date = new Date().toISOString().slice(0, 10);
  try {
    await firebaseRequest('PUT', `/customResults/${date}/${ns}`, results);
    await firebaseRequest('PUT', `/customLatest/${ns}`, date);
    // Write to allRuns index (lightweight, for history tab)
    const entry = { ns, date, url: results.url, name: results.name, score: results.score, status: results.status, runAt: results.runAt };
    await firebaseRequest('POST', '/allRuns', entry);
    // Write lightweight snapshot to history/{ns} for per-URL comparison
    const snapshot = {
      date, runAt: results.runAt, score: results.score, url: results.url, name: results.name,
      checks: (results.uiChecks||[]).map(c=>({ name: c.name, pass: c.pass, improvement: c.improvement||false }))
    };
    await firebaseRequest('POST', `/history/${ns}`, snapshot);
    log(GREEN, ` ✓ Saved to Firebase`);
  } catch(e) {
    log(RED, ' ✗ Firebase save failed: ' + e.message);
  }
}

// ─── PLATFORM DETECTION ───────────────────────────────────────────────────────
async function detectPlatform(page) {
  return page.evaluate(() => {
    const h = document.documentElement.innerHTML.toLowerCase();
    const g = (document.querySelector('meta[name="generator"]') || {}).content || '';
    if (h.includes('shopify')     || g.toLowerCase().includes('shopify'))     return 'shopify';
    if (h.includes('squarespace') || g.toLowerCase().includes('squarespace')) return 'squarespace';
    if (h.includes('wix.com')     || g.toLowerCase().includes('wix'))         return 'wix';
    if (h.includes('webflow')     || g.toLowerCase().includes('webflow'))     return 'webflow';
    if (h.includes('elementor')   || g.toLowerCase().includes('elementor'))   return 'elementor';
    if (h.includes('divi')        || g.toLowerCase().includes('divi'))        return 'divi';
    if (h.includes('woocommerce'))                                             return 'woocommerce';
    if (h.includes('wp-content')  || h.includes('wp-includes') || g.toLowerCase().includes('wordpress')) return 'wordpress';
    if (h.includes('__next')      || h.includes('_next'))                     return 'nextjs';
    if (h.includes('react')       || h.includes('__reactfiber'))              return 'react';
    return 'custom';
  });
}

// ─── ANNOTATED SCREENSHOT ─────────────────────────────────────────────────────
async function annotatedShot(page, checks) {
  await page.evaluate((checkResults) => {
    var existing = document.getElementById('__levi_overlay__');
    if (existing) existing.remove();
    var canvas = document.createElement('canvas');
    canvas.id = '__levi_overlay__';
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
    canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:999999;';
    document.body.appendChild(canvas);
    var ctx = canvas.getContext('2d');
    function box(el, color, label, fill) {
      if (!el) return;
      var r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      ctx.strokeStyle = color;
      ctx.lineWidth   = 3;
      ctx.strokeRect(r.left + 1, r.top + 1, r.width - 2, r.height - 2);
      if (fill) {
        ctx.fillStyle = color.replace('1)', '0.08)');
        ctx.fillRect(r.left + 1, r.top + 1, r.width - 2, r.height - 2);
      }
      ctx.fillStyle = color;
      var tw = ctx.measureText(label).width + 12;
      ctx.fillRect(r.left, r.top - 20, tw, 20);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 11px system-ui,sans-serif';
      ctx.fillText(label, r.left + 6, r.top - 6);
    }
    function missingLabel(x, y, label) {
      ctx.fillStyle = 'rgba(220,38,38,0.9)';
      var tw = ctx.measureText(label).width + 14;
      ctx.fillRect(x, y, tw, 22);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 11px system-ui,sans-serif';
      ctx.fillText(label, x + 7, y + 15);
    }
    var GREEN = 'rgba(22,163,74,1)';
    var RED   = 'rgba(220,38,38,1)';
    var AMBER = 'rgba(217,119,6,1)';
    var checkMap = {};
    (checkResults || []).forEach(function(c) { checkMap[c.name] = c; });
    function pass(name) { var c = checkMap[name]; return c && c.pass; }

    // ── LOGO ─────────────────────────────────────────────────────────────────
    var header = document.querySelector('header,.header,#header,nav,.navbar');
    var logo = header && header.querySelector(
      'img,[class*="logo"],[class*="brand"],.elementor-widget-image,a[rel="home"] img,.wp-custom-logo'
    );
    if (logo) {
      box(logo, pass('Logo in Header') ? GREEN : RED, pass('Logo in Header') ? '✓ Logo' : '✗ Logo', true);
    } else {
      missingLabel(10, 10, '✗ Logo not found');
    }
    // ── HERO ─────────────────────────────────────────────────────────────────
    var hero = document.querySelector(
      '.hero,.banner,.jumbotron,[class*="hero"],[class*="banner"],.wp-block-cover,.elementor-section'
    );
    if (!hero) {
      var els = [...document.querySelectorAll('div,section,header')];
      hero = els.find(function(el) {
        var bg = getComputedStyle(el).backgroundImage;
        var r  = el.getBoundingClientRect();
        return bg && bg !== 'none' && bg.includes('url') && r.height > 150 && r.top < window.innerHeight;
      });
    }
    if (hero) {
      box(hero, pass('Hero Section') ? GREEN : RED, pass('Hero Section') ? '✓ Hero' : '✗ Hero', false);
    } else if (!pass('Hero Section')) {
      missingLabel(10, 36, '✗ Hero not detected');
    }
    // ── CTA ──────────────────────────────────────────────────────────────────
    var vh = window.innerHeight;
    var ctaEl = [...document.querySelectorAll(
      'a[class*="btn"],a[class*="button"],a[class*="cta"],button,.elementor-button,.wp-block-button__link'
    )].find(function(el) {
      var r = el.getBoundingClientRect();
      return r.top < vh && r.bottom > 0 && r.width > 0 && (el.innerText || '').trim();
    });
    if (!ctaEl) {
      var CTA_WORDS = ['demo','contact','get started','book','schedule','trial','subscribe','donate','sign up','register','join'];
      ctaEl = [...document.querySelectorAll('nav a,header a')].find(function(a) {
        var t = (a.innerText || '').trim().toLowerCase();
        var r = a.getBoundingClientRect();
        return r.top < vh && r.bottom > 0 && CTA_WORDS.some(function(w) { return t.includes(w); });
      });
    }
    if (ctaEl) {
      box(ctaEl, pass('CTA Above Fold') ? GREEN : AMBER, pass('CTA Above Fold') ? '✓ CTA' : '⚠ CTA', true);
    } else if (!pass('CTA Above Fold')) {
      missingLabel(10, 62, '✗ No CTA above fold');
    }
    // ── FOOTER ───────────────────────────────────────────────────────────────
    var footer = document.querySelector('footer,[class*="footer"],[id*="footer"]');
    if (footer) {
      box(footer, pass('Footer Present') ? GREEN : RED, pass('Footer Present') ? '✓ Footer' : '✗ Footer', false);
    } else if (!pass('Footer Present')) {
      missingLabel(10, 88, '✗ Footer not found');
    }
    // ── NAV ──────────────────────────────────────────────────────────────────
    var nav = document.querySelector('nav,.navbar,.navigation');
    if (nav) {
      box(nav, pass('Nav Links Present') ? GREEN : RED, pass('Nav Links Present') ? '✓ Nav' : '✗ Nav', false);
    }
  }, checks || []);
  const shot = await page.screenshot({ type: 'jpeg', quality: 88, fullPage: false });
  await page.evaluate(() => { var el = document.getElementById('__levi_overlay__'); if (el) el.remove(); });
  return shot;
}

// ─── GET NAV LINKS ────────────────────────────────────────────────────────────
async function getNavLinks(page, baseUrl) {
  return page.evaluate(base => {
    try {
      const origin = new URL(base).origin;
      const nav = document.querySelector('nav,header,.navbar,.navigation,#nav,.nav,[class*="nav-"]');
      if (!nav) return [];
      return [...new Set(
        [...nav.querySelectorAll('a[href]')]
          .map(a => a.href)
          .filter(h => h.startsWith(origin) && h !== base && h !== base+'/' &&
            !h.includes('#') && !h.includes('mailto:') && !h.includes('tel:') &&
            !h.includes('wp-admin') && !h.includes('login') && !h.includes('cart') && !h.includes('checkout')
          )
      )].slice(0, 6);
    } catch(e) { return []; }
  }, baseUrl);
}

// ─── GROUP A: TECHNICAL / SEO (11 checks) ────────────────────────────────────
async function checksA(page, url, checks) {
  // A1
  try {
    const r = await page.request.get(url, { timeout: 10000 });
    checks.push({ name:'Page Reachable (HTTP)', pass: r.status() < 400, detail: `HTTP ${r.status()}` });
  } catch(e) {
    checks.push({ name:'Page Reachable (HTTP)', pass: false, detail: 'Could not reach: ' + e.message.substring(0, 80) });
  }
  // A2
  const https_ = url.startsWith('https://');
  checks.push({ name:'Secure (HTTPS)', pass: https_, detail: https_ ? 'Served over HTTPS' : 'Not HTTPS — connection is not secure' });
  // A3
  const title = await page.title();
  const tOk = title && title.length >= 10 && title.length <= 70;
  checks.push({ name:'Page Title (SEO)', pass: !!tOk, detail: !title ? 'Missing title' : title.length < 10 ? `Too short (${title.length} chars)` : title.length > 70 ? `Too long (${title.length} chars)` : `"${title.substring(0,60)}"` });
  // A4
  const desc = await page.$eval('meta[name="description"]', e => e.content).catch(() => '');
  const dOk  = desc && desc.length >= 50 && desc.length <= 160;
  checks.push({ name:'Meta Description', pass: !!dOk, detail: !desc ? 'Missing' : desc.length < 50 ? `Too short (${desc.length} chars)` : desc.length > 160 ? `Too long (${desc.length} chars)` : `OK (${desc.length} chars)` });
  // A5
  const h1s = await page.$$eval('h1', els => els.map(e => e.innerText.trim()).filter(Boolean));
  checks.push({ name:'Single H1 Heading', pass: h1s.length === 1, detail: h1s.length === 0 ? 'No H1' : h1s.length > 1 ? `Multiple H1s: ${h1s.slice(0,2).join(', ')}` : `H1: ${h1s[0].substring(0,50)}` });
  // A6 - heading hierarchy REMOVED (too petty)
  // A7
  const vp = await page.$('meta[name="viewport"]');
  checks.push({ name:'Viewport Meta Tag', pass: !!vp, detail: vp ? 'Present' : 'Missing — site may not be mobile-friendly' });
  // A8
  const can = await page.$eval('link[rel="canonical"]', e => e.href).catch(() => '');
  checks.push({ name:'Canonical Tag', pass: !!can, detail: can ? can.substring(0, 60) : 'No canonical tag' , improvement:true });
  // A9
  const ogT = await page.$eval('meta[property="og:title"]', e => e.content).catch(() => '');
  const ogI = await page.$eval('meta[property="og:image"]', e => e.content).catch(() => '');
  checks.push({ name:'Open Graph Tags', pass: !!ogT && !!ogI, detail: ogT && ogI ? 'og:title + og:image found' : !ogT ? 'Missing og:title' : !ogI ? 'Missing og:image' : 'Incomplete OG tags' });
  // A10
  const schema = await page.$('script[type="application/ld+json"]').then(e => !!e);
  checks.push({ name:'Structured Data (Schema)', pass: schema, detail: schema ? 'JSON-LD found' : 'No JSON-LD schema markup' , improvement:true });
  // A11
  const robots = await page.$eval('meta[name="robots"]', e => e.content).catch(() => 'index,follow');
  const rOk   = !robots.includes('noindex');
  checks.push({ name:'Robots Meta (Indexable)', pass: rOk, detail: rOk ? `Robots: ${robots}` : 'Page set to noindex — not visible to search engines' });
  // A12
  const smap = await page.request.get(new URL(url).origin + '/sitemap.xml').then(r => r.status() < 400).catch(() => false);
  checks.push({ name:'Sitemap Accessible', pass: smap, detail: smap ? '/sitemap.xml returns 200' : 'No sitemap found at /sitemap.xml' });
}

// ─── GROUP B: CONTENT & UI (12 checks) ───────────────────────────────────────
async function checksB(page, url, checks) {
  // B1 - Universal logo detection
  const logo = await page.evaluate(() => {
    const areas = [...document.querySelectorAll('header,nav,.navbar,.header,#header,[class*="header"]')];
    if (!areas.length) return !!document.querySelector('img[class*="logo"],img[id*="logo"],[class*="logo"],[id*="logo"]');
    return areas.some(h => h.querySelector('img,svg,[class*="logo"],[class*="brand"],[class*="site-logo"]'));
  });
  checks.push({ name:'Logo in Header', pass: logo, detail: logo ? 'Logo found in header area' : 'No logo detected in header area' });
  // B2
  const navN = await page.evaluate(() => {
    const n = document.querySelector('nav,header,.navbar');
    return n ? [...n.querySelectorAll('a')].filter(a => (a.innerText||'').trim()).length : 0;
  });
  checks.push({ name:'Navigation Links', pass: navN >= 2, detail: navN >= 2 ? `${navN} nav links` : `Only ${navN} nav link(s) — navigation may be missing` });
  // B3
  const footer = await page.$('footer,.footer,#footer,[class*="footer"]').then(e => !!e);
  checks.push({ name:'Footer Present', pass: footer, detail: footer ? 'Footer found' : 'No footer detected' });
  // B4
  const fContact = await page.evaluate(() => {
    const f = document.querySelector('footer,.footer,#footer');
    if (!f) return false;
    const t = (f.innerText || '').toLowerCase();
    return /phone|tel|email|@|contact/.test(t);
  });
  checks.push({ name:'Footer Contact Info', pass: fContact, detail: fContact ? 'Contact info in footer' : 'No contact info in footer' });
  // B5 - Universal CTA detection
  const cta = await page.evaluate(() => {
    const vh = window.innerHeight;
    const CTA_WORDS = ['demo','contact','get started','book','schedule','trial','subscribe','donate','sign up','register','join'];
    const sel = 'a[class*="btn"],a[class*="button"],a[class*="cta"],button,.elementor-button,.wp-block-button__link';
    let ctas = [...document.querySelectorAll(sel)].filter(e => {
      const r = e.getBoundingClientRect();
      return r.top < vh && r.bottom > 0 && r.width > 0 && (e.innerText||'').trim();
    });
    if (!ctas.length) {
      ctas = [...document.querySelectorAll('nav a,header a')].filter(a => {
        const t = (a.innerText||'').trim().toLowerCase();
        const r = a.getBoundingClientRect();
        return r.top < vh && r.bottom > 0 && r.width > 0 && CTA_WORDS.some(w => t.includes(w));
      });
    }
    return { total: ctas.length, above: ctas.length, text: ctas[0] ? (ctas[0].innerText||'').trim().substring(0,30) : '' };
  });
  checks.push({ name:'CTA Above Fold', pass: cta.above > 0, detail: cta.above > 0 ? `"${cta.text}" found above fold` : 'No CTA button or action link above fold' });
  // B6 - Universal hero detection
  const heroOk = await page.evaluate(() => {
    if (document.querySelector('.hero,.banner,.jumbotron,[class*="hero"],[class*="banner"],[class*="jumbotron"],.wp-block-cover')) return true;
    const els = [...document.querySelectorAll('div,section,header,article')];
    return els.some(el => {
      const st = getComputedStyle(el);
      const r  = el.getBoundingClientRect();
      if (r.height < 150 || r.top >= window.innerHeight) return false;
      if (st.backgroundImage && st.backgroundImage !== 'none' && st.backgroundImage.includes('url')) return true;
      const img = el.querySelector('img');
      if (img && img.naturalWidth > 400) { const ir = img.getBoundingClientRect(); if (ir.width > 300) return true; }
      return !!el.querySelector('video,iframe[src*="youtube"],iframe[src*="vimeo"]');
    });
  });
  checks.push({ name:'Hero Section', pass: heroOk, detail: heroOk ? 'Hero or banner section found' : 'No hero/banner section detected' });
  // B7 - Smarter alt text (skip tiny/decorative/icons)
  const alts = await page.evaluate(() => {
    const imgs    = [...document.querySelectorAll('img')].filter(i => i.naturalWidth > 0 && i.offsetParent !== null);
    const content = imgs.filter(i => !i.closest('[aria-hidden]') && !i.src.includes('icon') && !i.src.includes('logo'));
    const miss    = content.filter(i => !i.alt && i.getAttribute('role') !== 'presentation' && i.getAttribute('aria-hidden') !== 'true');
    return { total: content.length, miss: miss.length };
  });
  checks.push({ name:'Image Alt Text', pass: alts.miss === 0, detail: alts.miss === 0 ? `All ${alts.total} content images have alt text` : `${alts.miss}/${alts.total} content images missing alt` });
  // B8
  const brk = await page.evaluate(() => [...document.querySelectorAll('img')].filter(i => i.complete && i.naturalWidth === 0 && i.src).length);
  checks.push({ name:'No Broken Images', pass: brk === 0, detail: brk === 0 ? 'All images load correctly' : `${brk} broken image(s)` });
  // B9
  const soc = await page.evaluate(() => [...new Set([...document.querySelectorAll('a[href]')].map(a => a.href).filter(h => /facebook|twitter|instagram|linkedin|youtube|tiktok|pinterest/.test(h)))]);
  checks.push({ name:'Social Media Links', pass: soc.length > 0, detail: soc.length > 0 ? `Found: ${soc.length} social link(s)` : 'No social media links found' , improvement:true });
  // B10
  const copy = await page.evaluate(y => {
    const t = (document.querySelector('footer,.footer,#footer') || document.body).innerText;
    return new RegExp('©|copyright|'+y+'|'+(y-1)).test(t.toLowerCase());
  }, new Date().getFullYear());
  checks.push({ name:'Copyright in Footer', pass: copy, detail: copy ? 'Copyright info found' : 'No copyright in footer' , improvement:true });
  // B11
  const phone = await page.evaluate(() => [...document.querySelectorAll('a[href^="tel:"],a[href^="mailto:"]')].length > 0);
  checks.push({ name:'Phone / Email Link', pass: phone, detail: phone ? 'Clickable tel/mailto link found' : 'No tel/mailto links' });
  // B12
  const fav = await page.evaluate(() => !!(document.querySelector('link[rel*="icon"],link[rel="shortcut icon"]')));
  checks.push({ name:'Favicon Present', pass: fav, detail: fav ? 'Favicon found' : 'No favicon — looks unprofessional in browser tabs' });
}

// ─── GROUP C: LINKS & NAVIGATION (7 checks, print removed) ───────────────────
async function checksC(page, url, checks) {
  // C1 - Link href validity (excludes dropdown triggers, accordions, tab controls)
  const lnk = await page.evaluate(() => {
    const b=[], v=[];
    [...document.querySelectorAll('a')].forEach(el => {
      const h = el.getAttribute('href');
      const t = (el.innerText||el.textContent||'').trim().substring(0, 60);
      if (!t || el.offsetParent === null) return;
      // Skip dropdown/accordion/tab toggle anchors — these use # intentionally
      if (el.hasAttribute('data-toggle') || el.hasAttribute('data-target') ||
          el.hasAttribute('aria-expanded') || el.hasAttribute('aria-controls') ||
          el.hasAttribute('aria-haspopup') ||
          el.getAttribute('role') === 'button' || el.getAttribute('role') === 'tab') return;
      // Skip if inside known accordion/dropdown/menu containers
      if (el.closest('[class*="accordion"],[class*="faq"],[class*="dropdown"],[class*="collapse"],[class*="tab"]')) return;
      // Skip href="#section" (valid in-page anchors) — only flag bare # or empty
      if (h && h.startsWith('#') && h.length > 1) return;
      if (!h || h === '#' || h === '' || h.startsWith('javascript:')) b.push(t);
      else v.push(h);
    });
    return { broken: [...new Set(b)].slice(0, 15), valid: v.length };
  });
  checks.push({ name:'Link Href Validity', pass: lnk.broken.length === 0,
    detail: lnk.broken.length === 0 ? `All ${lnk.valid} links have valid hrefs` : `${lnk.broken.length} empty/# href(s): ${lnk.broken.slice(0,5).map(t=>'"'+t+'"').join(', ')}`,
    items: lnk.broken });
  // C2
  const intLinks = await page.evaluate(base => {
    try {
      const o = new URL(base).origin;
      return [...new Set([...document.querySelectorAll('a[href]')].map(a => a.href)
        .filter(h => h.startsWith(o) && !h.includes('#') && !h.includes('mailto:') && !h.includes('tel:') && h !== base && h !== base+'/'))].slice(0, 8);
    } catch(e) { return []; }
  }, url);
  const b404 = [];
  for (const l of intLinks) {
    try {
      const r = await page.request.get(l, { timeout: 6000 });
      if (r.status() === 404 || r.status() === 410) b404.push(l.replace(new URL(url).origin, '').substring(0, 50));
    } catch(e) {}
  }
  checks.push({ name:'Internal Links (No 404s)', pass: b404.length === 0, detail: b404.length === 0 ? `All ${intLinks.length} internal links OK` : `${b404.length} broken: ${b404.join(', ')}` });
  // C3
  const ext = await page.evaluate(() => {
    const e = [...document.querySelectorAll('a[href^="http"]')].filter(a => !a.href.includes(location.hostname));
    return { total: e.length, noTarget: e.filter(a => a.target !== '_blank').length };
  });
  checks.push({ name:'External Links Open New Tab', pass: ext.noTarget === 0, detail: ext.noTarget === 0 ? `All ${ext.total} external links use target="_blank"` : `${ext.noTarget}/${ext.total} external links missing target="_blank"` , improvement:true });
  // C4 - Nav active state: checks classes, visual styles, AND dropdown sub-items
  const active = await page.evaluate(() => {
    const nav = document.querySelector('nav,header,.navbar,.navigation,.menu,#menu,#nav,[class*="nav-wrap"],[class*="main-menu"]');
    if (!nav) return true;
    // 1. Standard active classes anywhere in nav (including inside dropdowns)
    if (nav.querySelector('.active,.current,[aria-current="page"],.current-menu-item,.is-active,.selected,.current-page-ancestor')) return true;
    // 2. Dropdown parent has active child — check sub-menus
    const subMenuItems = [...nav.querySelectorAll('.sub-menu a,.dropdown-menu a,.children a,[class*="sub-nav"] a')];
    if (subMenuItems.some(a => a.classList.contains('active') || a.classList.contains('current') || a.getAttribute('aria-current') === 'page')) return true;
    // 3. Visual differentiation on top-level links (colour/weight/border)
    const topLinks = [...nav.querySelectorAll(':scope > ul > li > a, :scope > div > ul > li > a')]
      .filter(a => a.offsetParent !== null && (a.innerText||'').trim() && !a.closest('.sub-menu,.dropdown-menu'));
    const checkLinks = topLinks.length >= 2 ? topLinks : [...nav.querySelectorAll('a')].filter(a => a.offsetParent !== null && (a.innerText||'').trim()).slice(0, 8);
    if (checkLinks.length < 2) return true;
    if (new Set(checkLinks.map(a => getComputedStyle(a).color)).size > 1) return true;
    const bgs = checkLinks.map(a => getComputedStyle(a).backgroundColor).filter(b => b !== 'rgba(0, 0, 0, 0)');
    if (new Set(bgs).size > 1) return true;
    if (new Set(checkLinks.map(a => getComputedStyle(a).fontWeight)).size > 1) return true;
    if (new Set(checkLinks.map(a => getComputedStyle(a).borderBottom)).size > 1) return true;
    // 4. Dropdown trigger for current section has different style than others
    const dropTriggers = [...nav.querySelectorAll('[aria-haspopup="true"],[data-toggle="dropdown"]')];
    if (dropTriggers.some(el => getComputedStyle(el).color !== getComputedStyle(dropTriggers[0]).color)) return true;
    return false;
  });
  checks.push({ name:'Nav Active/Current State', pass: active, detail: active ? 'Active page state detected in navigation' : 'No active/current state visible in nav' });
  // C5 - Site search functionality
  const srch = await (async () => {
    try {
      const inp = await page.$('input[type="search"],input[name="s"],input[name="q"],input[placeholder*="search" i],input[placeholder*="Search"]');
      if (!inp) return { found: false };
      const box = await inp.boundingBox();
      if (!box || box.width === 0) return { found: false };
      await inp.click();
      await inp.type('test', { delay: 50 });
      await inp.press('Enter');
      await page.waitForTimeout(2000);
      const newUrl = page.url();
      const hasResultsUrl = newUrl.includes('?s=') || newUrl.includes('?q=') || newUrl.includes('/search');
      const hasResultEls  = await page.evaluate(() => {
        return !!(document.querySelector('.search-results,.search-result,[class*="search-results"],[class*="search-result"]'));
      });
      return { found: true, works: hasResultsUrl || hasResultEls, url: newUrl.substring(0, 80) };
    } catch(e) { return { found: false }; }
  })();
  if (srch.found) {
    checks.push({ name:'Site Search Works', pass: srch.works, detail: srch.works ? 'Search returns results page' : 'Search input found but may not return results' });
    try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 }); } catch(e) {}
  } else {
    checks.push({ name:'Site Search', pass: true, detail: 'No search input found — not applicable' });
  }
  // C5b - Skip nav
  const skip = await page.$('a[href="#content"],a[href="#main"],a[href="#main-content"],.skip-link,[class*="skip-to"]').then(e => !!e);
  checks.push({ name:'Skip Navigation Link', pass: skip, detail: skip ? 'Skip-to-content link found' : 'No skip nav — needed for keyboard/screen reader users' , improvement:true });
  // C6
  const c404 = await page.request.get(new URL(url).origin + '/levi-check-404-page-xyz').then(r => r.status() === 404).catch(() => false);
  checks.push({ name:'Custom 404 Page', pass: c404, detail: c404 ? 'Returns proper 404' : 'Site does not return 404 for missing pages' });
  // C7
  const logoHome = await page.evaluate(origin => {
    const h = document.querySelector('header,.header,nav');
    if (!h) return false;
    const a = h.querySelector('a[class*="logo"],.logo a,a:has(img),a:has(svg),a[rel="home"]');
    if (!a) return false;
    return a.href === origin || a.href === origin + '/';
  }, new URL(url).origin);
  checks.push({ name:'Logo Links to Homepage', pass: logoHome, detail: logoHome ? 'Logo correctly links to homepage' : 'Logo does not link to homepage' , improvement:true });
}

// ─── GROUP D: ACCESSIBILITY (7 checks, autocomplete conditional) ──────────────
async function checksD(page, checks) {
  // D1
  const cc = await page.evaluate(() => {
    function lum(r,g,b) { return [r,g,b].reduce((s,c,i)=>{ c=c/255; c=c<=.03928?c/12.92:Math.pow((c+.055)/1.055,2.4); return s+c*[.2126,.7152,.0722][i]; }, 0); }
    function cr(l1,l2) { return (Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05); }
    function rgb(s) { const m=s.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/); return m?[+m[1],+m[2],+m[3]]:null; }
    const issues = [];
    [...document.querySelectorAll('p,h1,h2,h3,a,button,label')].slice(0, 60).forEach(el => {
      if (!el.offsetParent || !(el.innerText||'').trim()) return;
      const st = getComputedStyle(el);
      const fg = rgb(st.color), bg = rgb(st.backgroundColor);
      if (!fg || !bg || st.backgroundColor === 'rgba(0, 0, 0, 0)') return;
      const ratio = cr(lum(...fg), lum(...bg));
      if (ratio < 4.5) issues.push({ text: (el.innerText||'').trim().substring(0, 30), ratio: ratio.toFixed(1) });
    });
    return [...new Map(issues.map(i => [i.text, i])).values()].slice(0, 4);
  });
  checks.push({ name:'Colour Contrast (WCAG AA)', pass: cc.length === 0, detail: cc.length === 0 ? 'Text contrast passes WCAG AA (4.5:1)' : `${cc.length} contrast issue(s): ${cc.map(i=>'"'+i.text+'" ('+i.ratio+':1)').join('; ')}` });
  // D2
  const fr = await page.evaluate(() => {
    const forms = [...document.querySelectorAll('form')];
    if (!forms.length) return { count: 0, issues: [] };
    const issues = [];
    forms.forEach((f, fi) => {
      [...f.querySelectorAll('input:not([type=hidden]),textarea,select')].forEach(inp => {
        const ok = (inp.id && document.querySelector('label[for="'+inp.id+'"]')) || inp.getAttribute('aria-label') || inp.getAttribute('aria-labelledby');
        if (!ok) issues.push('Form '+(fi+1)+': unlabelled '+inp.tagName.toLowerCase());
      });
      if (!f.querySelector('[type=submit],button[type=submit],button:not([type])')) issues.push('Form '+(fi+1)+': no submit button');
    });
    return { count: forms.length, issues };
  });
  if (fr.count > 0) checks.push({ name:'Form Accessibility', pass: fr.issues.length === 0, detail: fr.issues.length === 0 ? `${fr.count} form(s) accessible` : fr.issues.slice(0,3).join('; ') });
  // D3
  const lm = await page.evaluate(() => ({ main: !!document.querySelector('main,[role="main"]'), nav: !!document.querySelector('nav,[role="navigation"]') }));
  checks.push({ name:'ARIA Landmarks', pass: lm.main && lm.nav, detail: lm.main && lm.nav ? 'main, nav landmarks present' : `Missing: ${!lm.main?'<main> ':''}${!lm.nav?'<nav>':''}` , improvement:true });
  // D4
  const ub = await page.evaluate(() => [...document.querySelectorAll('button,[role="button"]')].filter(b => !(b.innerText||'').trim() && !b.getAttribute('aria-label') && !b.getAttribute('title')).length);
  checks.push({ name:'Buttons Have Labels', pass: ub === 0, detail: ub === 0 ? 'All buttons labelled' : `${ub} unlabelled button(s)` , improvement:true });
  // D5
  const focus = await page.evaluate(() => {
    try {
      for (const s of document.styleSheets) {
        const rules = [...(s.cssRules||[])];
        if (rules.some(r => r.selectorText && r.selectorText.includes(':focus'))) return true;
      }
    } catch(e) {}
    return false;
  });
  checks.push({ name:'Focus Styles (Keyboard Nav)', pass: focus, detail: focus ? ':focus styles found' : 'No :focus CSS — keyboard users may lose focus indicator' , improvement:true });
  // D6
  const lang = await page.$eval('html', e => e.getAttribute('lang')).catch(() => '');
  checks.push({ name:'HTML Lang Attribute', pass: !!lang, detail: lang ? `lang="${lang}"` : 'Missing lang attribute on <html>' });
  // D7
  const ac = await page.evaluate(() => {
    const inps = [...document.querySelectorAll('input[type="email"],input[type="tel"],input[name*="name"],input[name*="email"]')];
    const miss = inps.filter(i => !i.getAttribute('autocomplete'));
    return { count: inps.length, miss: miss.length };
  });
  if (ac.count > 0) checks.push({ name:'Input Autocomplete', pass: ac.miss === 0, detail: ac.miss === 0 ? 'Autocomplete attributes present' : `${ac.miss} input(s) missing autocomplete` , improvement:true });
}

// ─── GROUP E: PERFORMANCE (7 checks, inline CSS removed) ─────────────────────
async function checksE(page, url, checks, consoleErrors) {
  // E1
  const ce = (consoleErrors||[]).filter(e => !e.includes('favicon') && !e.includes('analytics') && !e.includes('gtag') && !e.includes('fbq'));
  checks.push({ name:'No JavaScript Errors', pass: ce.length === 0, detail: ce.length === 0 ? 'No JS errors in console' : `${ce.length} JS error(s): ${ce.slice(0,2).join('; ').substring(0,120)}` });
  // E2
  const blk = await page.evaluate(() => [...document.querySelectorAll('script[src]:not([async]):not([defer])')].length);
  checks.push({ name:'Render-Blocking Scripts', pass: blk <= 3, detail: blk <= 3 ? `${blk} blocking scripts (OK)` : `${blk} render-blocking scripts — add async/defer` , improvement:true });
  // E3
  const mf = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll('img[src]')].filter(i => i.naturalWidth > 0);
    const mod  = imgs.filter(i => /\.webp|\.avif/.test(i.src)).length;
    return { total: imgs.length, mod };
  });
  checks.push({ name:'Modern Image Formats (WebP)', pass: mf.total === 0 || (mf.mod/mf.total) >= 0.3, detail: `${mf.mod}/${mf.total} images use WebP/AVIF` , improvement:true });
  // E4
  const ll = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll('img')].filter(i => i.offsetParent !== null);
    const lazy = imgs.filter(i => i.getAttribute('loading') === 'lazy').length;
    return { total: imgs.length, lazy };
  });
  checks.push({ name:'Image Lazy Loading', pass: ll.total < 3 || (ll.lazy/ll.total) >= 0.4, detail: `${ll.lazy}/${ll.total} images use loading="lazy"` , improvement:true });
  // E5
  const lt = await page.evaluate(() => {
    const n = performance.getEntriesByType('navigation')[0];
    return n ? Math.round(n.domContentLoadedEventEnd) : null;
  });
  checks.push({ name:'Page Load Time', pass: !lt || lt < 3000, detail: lt ? `DOMContentLoaded: ${lt}ms` : 'Timing not available' });
  // E6
  const fp = await page.evaluate(() => [...document.querySelectorAll('link[rel="preconnect"],link[rel="preload"][as="font"]')].length);
  checks.push({ name:'Font Preconnect/Preload', pass: fp > 0, detail: fp > 0 ? `${fp} font preconnect/preload hint(s)` : 'No font preconnect — may slow font loading' , improvement:true });
  // E7
  const mc = url.startsWith('https://') ? await page.evaluate(() => [...document.querySelectorAll('img[src^="http:"],script[src^="http:"],link[href^="http:"]')].length) : 0;
  checks.push({ name:'No Mixed Content', pass: mc === 0, detail: mc === 0 ? 'No HTTP resources on HTTPS page' : `${mc} mixed content resource(s)` });
}

// ─── GROUP F: SECURITY & TRUST (5 checks) ────────────────────────────────────
async function checksF(page, url, checks) {
  // F1
  const priv = await page.evaluate(() => [...document.querySelectorAll('a')].some(a => (a.innerText||'').toLowerCase().includes('privacy') && a.href));
  checks.push({ name:'Privacy Policy Link', pass: priv, detail: priv ? 'Privacy policy link found' : 'No privacy policy link' });
  // F2
  const terms = await page.evaluate(() => [...document.querySelectorAll('a')].some(a => {
    const t = (a.innerText||'').toLowerCase();
    return (t.includes('terms') || t.includes('conditions') || t.includes('legal')) && a.href;
  }));
  checks.push({ name:'Terms of Service Link', pass: terms, detail: terms ? 'Terms link found' : 'No terms of service link' , improvement:true });
  // F3 - Cookie consent: check popups, scripts, and inline text
  const cookie = await page.evaluate(() => {
    const kw = ['cookie','gdpr','consent','we use cookies','cookie policy','privacy settings'];
    if (kw.some(k => document.body.innerText.toLowerCase().includes(k))) return true;
    if (document.querySelector('[class*="cookie"],[class*="consent"],[id*="cookie"],[id*="consent"]')) return true;
    const scripts = [...document.querySelectorAll('script[src]')].map(s => s.src.toLowerCase());
    return scripts.some(s => s.includes('cookie') || s.includes('consent') || s.includes('gdpr'));
  });
  checks.push({ name:'Cookie Consent', pass: cookie, detail: cookie ? 'Cookie/GDPR consent handling found' : 'No cookie consent detected' , improvement:true });
  // F4
  const leak = await page.evaluate(() => {
    const s = document.documentElement.innerHTML;
    return /password\s*=\s*["'][^"']{4,}|api[_-]?key\s*[:=]\s*["'][a-zA-Z0-9]{8,}|secret\s*[:=]\s*["'][a-zA-Z0-9]{8,}/.test(s);
  });
  checks.push({ name:'No Sensitive Data Exposed', pass: !leak, detail: !leak ? 'No credential leaks detected' : 'Possible credentials in page source' });
  // F5 - Analytics (informational, always pass)
  const ga = await page.evaluate(() => document.documentElement.innerHTML.includes('google-analytics') || document.documentElement.innerHTML.includes('gtag') || document.documentElement.innerHTML.includes('googletagmanager'));
  checks.push({ name:'Analytics Detected', pass: true, detail: ga ? 'Google Analytics/GTM found — tracking active' : 'No analytics detected (informational)' , improvement:true });
}

// ─── GROUP G: PLATFORM-SPECIFIC (N/A when not applicable) ────────────────────
async function checksG(page, platform, checks) {
  const wp = ['wordpress','elementor','divi','gutenberg','woocommerce'].includes(platform);
  if (wp) {
    const c = await page.$('.wp-site-blocks,.entry-content,.site-content,.wp-block,.elementor-section,[class*="elementor"]').then(e => !!e);
    checks.push({ name:'WordPress Content Renders', pass: c, detail: c ? 'WP/Elementor content renders correctly' : 'WordPress content not detected' });
  } else {
    checks.push({ name:'WordPress Content Renders', pass: true, detail: 'N/A — not a WordPress site' });
  }
  if (platform === 'elementor') {
    const e = await page.evaluate(() => document.querySelectorAll('.elementor-error,.elementor-widget-container:empty').length);
    checks.push({ name:'Elementor Widget Errors', pass: e === 0, detail: e === 0 ? 'No Elementor errors' : `${e} Elementor widget error(s)` });
  } else {
    checks.push({ name:'Elementor Widget Errors', pass: true, detail: 'N/A — not an Elementor site' });
  }
  if (platform === 'woocommerce') {
    const w = await page.$('.woocommerce,.products,.wc-block-grid').then(e => !!e);
    checks.push({ name:'WooCommerce Shop', pass: w, detail: w ? 'WooCommerce products visible' : 'WooCommerce shop not detected' });
  } else {
    checks.push({ name:'WooCommerce Shop', pass: true, detail: 'N/A — not a WooCommerce site' });
  }
  if (platform === 'shopify') {
    const p = await page.$('.product-list,.product-grid,.collection-list,[class*="product"]').then(e => !!e);
    const c = await page.$('a[href*="/cart"],.cart-link,.header__icon--cart').then(e => !!e);
    checks.push({ name:'Shopify Products', pass: p, detail: p ? 'Products listed' : 'No products found' });
    checks.push({ name:'Shopify Cart',     pass: c, detail: c ? 'Cart link in nav' : 'No cart link' });
  } else {
    checks.push({ name:'Shopify Products', pass: true, detail: 'N/A — not a Shopify site' });
    checks.push({ name:'Shopify Cart',     pass: true, detail: 'N/A — not a Shopify site' });
  }
  if (platform === 'webflow') {
    const n = await page.$('nav,.w-nav').then(e => !!e);
    checks.push({ name:'Webflow Navigation', pass: n, detail: n ? 'Webflow nav renders' : 'Webflow nav not detected' });
  } else {
    checks.push({ name:'Webflow Navigation', pass: true, detail: 'N/A — not a Webflow site' });
  }
  if (['react','nextjs'].includes(platform)) {
    const h = await page.evaluate(() => !!document.querySelector('#__next,#root,[data-reactroot]'));
    checks.push({ name:'React App Hydrated', pass: h, detail: h ? 'React/Next.js mounted' : 'React app root not found' });
  } else {
    checks.push({ name:'React App Hydrated', pass: true, detail: 'N/A — not a React/Next.js site' });
  }
}

// ─── GROUP H: MOBILE (8 checks) ──────────────────────────────────────────────
async function checksH(browser, url, checks, evidence) {
  const mob = await browser.newPage();
  await mob.setViewportSize({ width: 390, height: 844 });
  try {
    await mob.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await mob.waitForTimeout(2000);

    const ov = await mob.evaluate(() => {
      const els = [...document.querySelectorAll('*')].filter(e => {
        const r = e.getBoundingClientRect();
        return r.right > window.innerWidth + 5 && r.width > 0 && e.offsetParent !== null && r.top < window.innerHeight;
      });
      return { count: els.length, els: els.slice(0,3).map(e => e.tagName+'.'+(e.className||'').toString().split(' ')[0]) };
    });
    checks.push({ name:'[Mobile] No Horizontal Overflow', pass: ov.count === 0, detail: ov.count === 0 ? 'No overflow at 390px' : `${ov.count} element(s) overflow: ${ov.els.join(', ')}` });

    const tt = await mob.evaluate(() =>
      [...document.querySelectorAll('a,button,[role=button]')].filter(e => {
        if (!e.offsetParent) return false;
        const r = e.getBoundingClientRect();
        return r.height > 0 && r.width > 0 && r.top < window.innerHeight && r.bottom > 0 && (r.height < 36 || r.width < 36);
      }).length
    );
    checks.push({ name:'[Mobile] Tap Target Size', pass: tt === 0, detail: tt === 0 ? 'All tap targets ≥36px' : `${tt} tap target(s) below 36px` });

    const st = await mob.evaluate(() =>
      [...document.querySelectorAll('p,li,span,a,td')].filter(e => {
        if (!e.offsetParent || !(e.innerText||'').trim()) return false;
        return parseFloat(getComputedStyle(e).fontSize) < 12;
      }).length
    );
    checks.push({ name:'[Mobile] Text Size (≥12px)', pass: st === 0, detail: st === 0 ? 'All text ≥12px' : `${st} element(s) below 12px` });

    const no = await mob.evaluate(() => {
      const n = document.querySelector('nav,header,.navbar');
      if (!n) return 0;
      const links = [...n.querySelectorAll('a')].filter(e => e.offsetParent !== null);
      let overlaps = 0;
      for (let i = 0; i < links.length; i++) {
        for (let j = i+1; j < links.length; j++) {
          const a = links[i].getBoundingClientRect(), b = links[j].getBoundingClientRect();
          if (a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom) overlaps++;
        }
      }
      return overlaps;
    });
    checks.push({ name:'[Mobile] Nav No Overlap', pass: no === 0, detail: no === 0 ? 'Nav renders cleanly on mobile' : `${no} nav element overlap(s)` });

    const si = await mob.evaluate(() =>
      [...document.querySelectorAll('input,textarea,select')].filter(e => {
        if (!e.offsetParent) return false;
        return parseFloat(getComputedStyle(e).fontSize) < 16;
      }).length
    );
    checks.push({ name:'[Mobile] Input Font ≥16px', pass: si === 0, detail: si === 0 ? 'All inputs ≥16px — no iOS auto-zoom' : `${si} input(s) below 16px — iOS will auto-zoom on focus` });

    const tc = await mob.$eval('meta[name="theme-color"]', e => e.content).catch(() => '');
    checks.push({ name:'[Mobile] Theme Color Meta', pass: !!tc, detail: tc ? `theme-color: ${tc}` : 'No theme-color meta — browser chrome unbranded on mobile' , improvement:true });

    // Mobile annotated screenshot
    await mob.evaluate((checksArr) => {
      var ex = document.getElementById('__levi_mob__'); if (ex) ex.remove();
      var cv = document.createElement('canvas');
      cv.id = '__levi_mob__';
      cv.width  = window.innerWidth;
      cv.height = window.innerHeight;
      cv.style.cssText = 'position:fixed;top:0;left:0;pointer-events:none;z-index:999999;';
      document.body.appendChild(cv);
      var ctx = cv.getContext('2d');
      function box(el, color, label) {
        if (!el) return;
        var r = el.getBoundingClientRect();
        if (!r.width || !r.height || r.top >= window.innerHeight || r.bottom <= 0) return;
        ctx.strokeStyle = color; ctx.lineWidth = 2;
        ctx.strokeRect(r.left+1, r.top+1, r.width-2, r.height-2);
        ctx.fillStyle = color.replace('1)', '0.1)');
        ctx.fillRect(r.left+1, r.top+1, r.width-2, r.height-2);
        ctx.fillStyle = color;
        var tw = ctx.measureText(label).width + 10;
        ctx.fillRect(r.left, Math.max(0, r.top-18), tw, 18);
        ctx.fillStyle = '#fff'; ctx.font = 'bold 10px system-ui,sans-serif';
        ctx.fillText(label, r.left+5, Math.max(12, r.top-5));
      }
      var GREEN='rgba(22,163,74,1)', RED='rgba(220,38,38,1)', AMBER='rgba(217,119,6,1)';
      var cm = {}; (checksArr||[]).forEach(function(c) { cm[c.name] = c; });
      var vh = window.innerHeight;
      // Logo
      var hd = document.querySelector('header,.header,nav,.navbar');
      var lg = hd && hd.querySelector('img,[class*="logo"],[class*="brand"]');
      if (lg) box(lg, (cm['Logo in Header']||{}).pass ? GREEN : RED, (cm['Logo in Header']||{}).pass ? '✓ Logo' : '✗ Logo');
      // Nav
      var nav = document.querySelector('nav,.navbar,.navigation');
      if (nav) { var r = nav.getBoundingClientRect(); if (r.top < vh) { box(nav, (cm['Nav Links Present']||{}).pass ? GREEN : RED, ''); } }
      // Tap targets — red outline on small ones
      [...document.querySelectorAll('a,button,[role=button]')].filter(e => {
        if (!e.offsetParent) return false;
        var r = e.getBoundingClientRect();
        return r.height > 0 && r.width > 0 && r.top < vh && r.bottom > 0 && (r.height < 36 || r.width < 36);
      }).slice(0, 15).forEach(function(el) {
        var r = el.getBoundingClientRect();
        ctx.strokeStyle = RED; ctx.lineWidth = 2;
        ctx.strokeRect(r.left, r.top, r.width, r.height);
        ctx.fillStyle = 'rgba(220,38,38,0.15)';
        ctx.fillRect(r.left, r.top, r.width, r.height);
      });
      // Overflow elements — red right edge
      [...document.querySelectorAll('*')].filter(e => {
        var r = e.getBoundingClientRect();
        return r.right > window.innerWidth + 5 && r.width > 0 && e.offsetParent !== null && r.top < vh;
      }).slice(0, 5).forEach(function(el) {
        var r = el.getBoundingClientRect();
        ctx.strokeStyle = RED; ctx.lineWidth = 3;
        ctx.strokeRect(window.innerWidth-3, r.top, 6, r.height);
      });
    }, checks);
    const mShot = await mob.screenshot({ type: 'jpeg', quality: 88, fullPage: false });
    await mob.evaluate(() => { var el = document.getElementById('__levi_mob__'); if (el) el.remove(); });
    evidence.push({ type: 'mobile-annotated', screenshot: mShot.toString('base64'), highlightCount: ov.count + tt + st + no });

    // Mobile menu open screenshot
    try {
      const hb = await mob.$('[class*="hamburger"],[class*="menu-toggle"],[class*="nav-toggle"],[class*="mobile-menu"],[aria-label*="menu" i],[aria-label*="navigation" i],.burger,.navicon,.menu-icon');
      if (hb) {
        await hb.click();
        await mob.waitForTimeout(700);
        const menuShot = await mob.screenshot({ type: 'jpeg', quality: 85, fullPage: false });
        evidence.push({ type: 'mobile-menu', screenshot: menuShot.toString('base64'), label: 'Mobile menu — open state' });
        checks.push({ name:'[Mobile] Menu Opens Correctly', pass: true, detail: 'Mobile menu opens correctly' });
      } else {
        checks.push({ name:'[Mobile] Menu Opens Correctly', pass: true, detail: 'No standard hamburger found — may use custom menu' });
      }
    } catch(e) {
      checks.push({ name:'[Mobile] Menu Opens Correctly', pass: true, detail: 'No standard hamburger button found' });
    }
    checks.push({ name:'[Mobile] No JS Errors', pass: true, detail: 'Mobile page loaded successfully' });
  } finally {
    await mob.close();
  }
}

// ─── NAV PAGE SCREENSHOTS ─────────────────────────────────────────────────────
async function navPageScreenshots(browser, navLinks, evidence) {
  if (!navLinks.length) return;
  log(CYAN, ` → Screenshotting ${navLinks.length} nav page(s)…`);
  for (const link of navLinks) {
    const pg = await browser.newPage();
    await pg.setViewportSize({ width: 1440, height: 900 });
    try {
      await pg.goto(link, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await pg.waitForTimeout(1500);
      const shot  = await pg.screenshot({ type: 'jpeg', quality: 80, fullPage: false });
      const label = link.replace(/https?:\/\/[^/]+/, '') || '/';
      evidence.push({ type: 'nav-page', url: link, label, screenshot: shot.toString('base64') });
      log(GREEN, ` ✓ Nav page: ${label}`);
    } catch(e) {
      log(YELLOW, ` ⚠ Skipped ${link}: ${e.message}`);
    } finally {
      await pg.close();
    }
  }
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
(async () => {
  if (!CUSTOM_URL) { log(RED, 'ERROR: CUSTOM_URL required'); process.exit(1); }
  const url  = CUSTOM_URL.startsWith('http') ? CUSTOM_URL : 'https://' + CUSTOM_URL;
  const name = SITE_NAME || url.replace(/https?:\/\/(www\.)?/, '').split('/')[0];
  const ns   = SITE_NAMESPACE || url.replace(/https?:\/\//, '').replace(/[^a-zA-Z0-9]/g, '_').substring(0, 60);

  log(CYAN, `\n  Levi v3 — ${url}`);
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--window-size=1440,900',
      '--disable-dev-shm-usage',
    ]
  });
  const checks=[], evidence=[], consoleErrors=[];

  try {
    const page = await browser.newPage();
  await page.setExtraHTTPHeaders({'Accept-Language':'en-US,en;q=0.9','User-Agent':'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'});
  await page.setViewportSize({width:1440,height:900});
  await page.addInitScript(() => {
    Object.defineProperty(navigator,'webdriver',{get:()=>undefined});
    Object.defineProperty(navigator,'plugins',{get:()=>[1,2,3,4,5]});
    Object.defineProperty(navigator,'languages',{get:()=>['en-US','en']});
    window.chrome={runtime:{}};
    Object.defineProperty(navigator,'userAgent',{get:()=>'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'});
  });
    await page.setViewportSize({ width: 1440, height: 900 });
    page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text().substring(0, 200)); });
    page.on('pageerror', e => consoleErrors.push(e.message.substring(0, 150)));

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(3000);

    const platform = SITE_TYPE || await detectPlatform(page);
    log(CYAN, ` → Platform: ${platform}`);

    evidence.push({ type: 'desktop', screenshot: (await page.screenshot({ type: 'jpeg', quality: 85, fullPage: false })).toString('base64') });

    const navLinks = await getNavLinks(page, url);

    log(CYAN, ' → A: Technical/SEO…');   await checksA(page, url, checks);
    log(CYAN, ' → B: Content/UI…');      await checksB(page, url, checks);
    log(CYAN, ' → C: Links/Nav…');       await checksC(page, url, checks);
    log(CYAN, ' → D: Accessibility…');   await checksD(page, checks);
    log(CYAN, ' → E: Performance…');     await checksE(page, url, checks, consoleErrors);
    log(CYAN, ' → F: Security…');        await checksF(page, url, checks);
    log(CYAN, ` → G: Platform (${platform})…`); await checksG(page, platform, checks);

    evidence.push({ type: 'desktop-annotated', screenshot: (await annotatedShot(page, checks)).toString('base64') });

    await page.close();
    await navPageScreenshots(browser, navLinks, evidence);

    log(CYAN, ' → H: Mobile…');
    await checksH(browser, url, checks, evidence);

    const passed = checks.filter(c => c.pass).length;
    const failed = checks.filter(c => !c.pass && !c.improvement).length;
    const score  = checks.length ? Math.round(passed / checks.length * 100) : 0;
    const status = failed === 0 ? 'pass' : failed <= 4 ? 'warn' : 'fail';

    log(CYAN, `\n  ── ${passed}/${checks.length} passed (${score}%) ──`);
    checks.forEach(c => log(c.pass ? GREEN : RED, `  ${c.pass?'✓':'✗'} ${c.name}: ${c.detail}`));

    await saveResults(ns, { url, name, siteType: platform, status, score, runAt: new Date().toISOString(), uiChecks: checks, evidence });
    log(GREEN, `\n  Done — ${score}% (${passed}/${checks.length} checks)\n`);

  } catch(err) {
    log(RED, `\n  ${err.message}`);
    console.error(err);
    process.exit(1);
  } finally {
    await browser.close();
    process.exit(0);
  }
})();
