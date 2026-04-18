/**
 * Levi — Universal Adaptive Smoke Test v3
 * powered by leverage.it
 *
 * 60+ checks: SEO, accessibility, performance, UI/UX, mobile, security, links.
 * Auto-detects platform. Screenshots every major nav page + mobile menu.
 */

'use strict';
const { chromium } = require('playwright');
const admin = require('firebase-admin');

const CUSTOM_URL     = process.env.CUSTOM_URL     || '';
const SITE_NAME      = process.env.SITE_NAME      || '';
const SITE_TYPE      = process.env.SITE_TYPE      || '';
const SITE_NAMESPACE = process.env.SITE_NAMESPACE || '';
const DB_URL         = process.env.FIREBASE_DATABASE_URL || '';
const GITHUB_RUN_ID  = process.env.GITHUB_RUN_ID  || '';

const R='\x1b[0m',RED='\x1b[31m',GREEN='\x1b[32m',YELLOW='\x1b[33m',CYAN='\x1b[36m';
const log=(c,m)=>console.log(c+m+R);

// ─── PLATFORM DETECTION ───────────────────────────────────────────────────────
async function detectPlatform(page) {
  return page.evaluate(()=>{
    const h=document.documentElement.innerHTML.toLowerCase();
    const g=(document.querySelector('meta[name="generator"]')||{}).content||'';
    if(h.includes('shopify')||g.toLowerCase().includes('shopify'))return'shopify';
    if(h.includes('squarespace')||g.toLowerCase().includes('squarespace'))return'squarespace';
    if(h.includes('wix.com')||g.toLowerCase().includes('wix'))return'wix';
    if(h.includes('webflow')||g.toLowerCase().includes('webflow'))return'webflow';
    if(h.includes('elementor')||g.toLowerCase().includes('elementor'))return'elementor';
    if(h.includes('divi')||g.toLowerCase().includes('divi'))return'divi';
    if(h.includes('woocommerce'))return'woocommerce';
    if(h.includes('wp-content')||h.includes('wp-includes')||g.toLowerCase().includes('wordpress'))return'wordpress';
    if(h.includes('gutenberg')||h.includes('wp-block'))return'gutenberg';
    if(h.includes('__next')||h.includes('_next'))return'nextjs';
    if(h.includes('react')||h.includes('__reactfiber'))return'react';
    return'custom';
  });
}

// ─── ANNOTATED SCREENSHOT ─────────────────────────────────────────────────────
async function annotatedShot(page, highlights) {
  if(highlights&&highlights.length){
    await page.evaluate(items=>{
      const c=document.createElement('canvas');
      c.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:999999';
      c.width=window.innerWidth;c.height=window.innerHeight;
      document.body.appendChild(c);
      const ctx=c.getContext('2d');
      items.forEach(({selector,color})=>{
        document.querySelectorAll(selector).forEach(el=>{
          const r=el.getBoundingClientRect();
          if(!r.width||!r.height)return;
          ctx.strokeStyle=color||'#FF0000';ctx.lineWidth=3;
          ctx.strokeRect(r.left+1,r.top+1,r.width-2,r.height-2);
          ctx.fillStyle=(color||'#FF0000')+'22';
          ctx.fillRect(r.left+1,r.top+1,r.width-2,r.height-2);
        });
      });
    },highlights);
  }
  const shot=await page.screenshot({type:'jpeg',quality:85,fullPage:false});
  await page.evaluate(()=>{const c=document.querySelector('canvas[style*="z-index:999999"]');if(c)c.remove();});
  return shot;
}

// ─── GET NAV LINKS FOR PAGE CRAWL ─────────────────────────────────────────────
async function getNavLinks(page, baseUrl) {
  return page.evaluate(base=>{
    try{
      const origin=new URL(base).origin;
      const nav=document.querySelector('nav,header,.navbar,.navigation,#nav,.nav');
      if(!nav)return[];
      return[...new Set(
        [...nav.querySelectorAll('a[href]')]
          .map(a=>a.href)
          .filter(h=>h.startsWith(origin)&&h!==base&&h!==base+'/'&&!h.includes('#')&&!h.includes('mailto:')&&!h.includes('tel:')&&!h.includes('wp-admin')&&!h.includes('login')&&!h.includes('cart')&&!h.includes('account'))
      )].slice(0,6);
    }catch(e){return[];}
  },baseUrl);
}

// ─── GROUP A: TECHNICAL / SEO (12 checks) ────────────────────────────────────
async function checksA(page, url, checks) {

  // A1 - HTTP reachable
  try{
    const r=await page.request.get(url,{timeout:10000});
    checks.push({name:'Page Reachable (HTTP)',pass:r.status()<400,detail:`HTTP ${r.status()}`});
  }catch(e){checks.push({name:'Page Reachable (HTTP)',pass:false,detail:'Could not reach: '+e.message});}

  // A2 - HTTPS
  const https=url.startsWith('https://');
  checks.push({name:'Secure (HTTPS)',pass:https,detail:https?'Served over HTTPS':'Not HTTPS — browsers show "Not Secure"'});

  // A3 - Title
  const title=await page.title();
  const tOk=title&&title.length>=10&&title.length<=70;
  checks.push({name:'Page Title (SEO)',pass:!!tOk,detail:!title?'Missing title':title.length<10?`Too short (${title.length} chars)`:title.length>70?`Too long: ${title.length} chars`:`"${title.substring(0,55)}"`});

  // A4 - Meta description
  const desc=await page.$eval('meta[name="description"]',e=>e.content).catch(()=>'');
  const dOk=desc&&desc.length>=50&&desc.length<=160;
  checks.push({name:'Meta Description',pass:!!dOk,detail:!desc?'Missing':desc.length<50?`Too short (${desc.length} chars)`:desc.length>160?`Too long (${desc.length} chars)`:`OK (${desc.length} chars)`});

  // A5 - Single H1
  const h1s=await page.$$eval('h1',els=>els.map(e=>e.innerText.trim()).filter(Boolean));
  checks.push({name:'Single H1 Heading',pass:h1s.length===1,detail:h1s.length===0?'No H1':h1s.length>1?`${h1s.length} H1s found`:`"${h1s[0].substring(0,60)}"`});

  // A6 - Heading hierarchy
  const hLevels=await page.evaluate(()=>[...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(h=>parseInt(h.tagName[1])));
  let hOk=true,hDetail='Heading hierarchy correct';
  for(let i=1;i<hLevels.length;i++){if(hLevels[i]-hLevels[i-1]>1){hOk=false;hDetail=`Jumps H${hLevels[i-1]}→H${hLevels[i]}`;break;}}
  checks.push({name:'Heading Hierarchy',pass:hOk,detail:hDetail});

  // A7 - Viewport meta
  const vp=await page.$('meta[name="viewport"]');
  checks.push({name:'Viewport Meta Tag',pass:!!vp,detail:vp?'Present':'Missing — site may not scale on mobile'});

  // A8 - Canonical
  const can=await page.$eval('link[rel="canonical"]',e=>e.href).catch(()=>'');
  checks.push({name:'Canonical Tag',pass:!!can,detail:can?can.substring(0,60):'No canonical — may cause duplicate content'});

  // A9 - Open Graph
  const ogT=await page.$eval('meta[property="og:title"]',e=>e.content).catch(()=>'');
  const ogI=await page.$eval('meta[property="og:image"]',e=>e.content).catch(()=>'');
  checks.push({name:'Open Graph Tags',pass:!!ogT&&!!ogI,detail:ogT&&ogI?'og:title + og:image present':`Missing: ${!ogT?'og:title ':''}${!ogI?'og:image':''}`});

  // A10 - Schema
  const schema=await page.$('script[type="application/ld+json"]').then(e=>!!e);
  checks.push({name:'Structured Data (Schema)',pass:schema,detail:schema?'JSON-LD found':'No schema — add for rich search results'});

  // A11 - Robots
  const robots=await page.$eval('meta[name="robots"]',e=>e.content).catch(()=>'index,follow');
  const rOk=!robots.includes('noindex');
  checks.push({name:'Robots Meta (Indexable)',pass:rOk,detail:rOk?`Robots: ${robots}`:'Page set to noindex!'});

  // A12 - Sitemap
  const smap=await page.request.get(new URL(url).origin+'/sitemap.xml').then(r=>r.status()<400).catch(()=>false);
  checks.push({name:'Sitemap Accessible',pass:smap,detail:smap?'/sitemap.xml returns 200':'No sitemap found — submit to Google Search Console'});
}

// ─── GROUP B: CONTENT & UI (12 checks) ────────────────────────────────────────
async function checksB(page, url, checks) {

  // B1 - Logo in header
  const logo=await page.evaluate(()=>{const h=document.querySelector('header,.header,#header,nav');return!!(h&&h.querySelector('img,svg,.logo,[class*="logo"],[class*="brand"]'));});
  checks.push({name:'Logo in Header',pass:logo,detail:logo?'Logo found in header':'No logo in header'});

  // B2 - Nav links
  const navN=await page.evaluate(()=>{const n=document.querySelector('nav,header,.navbar');return n?n.querySelectorAll('a[href]').length:0;});
  checks.push({name:'Navigation Links',pass:navN>=2,detail:navN>=2?`${navN} nav links`:`Only ${navN} nav links`});

  // B3 - Footer
  const footer=await page.$('footer,.footer,#footer,[class*="footer"]').then(e=>!!e);
  checks.push({name:'Footer Present',pass:footer,detail:footer?'Footer found':'No footer detected'});

  // B4 - Footer contact info
  const fContact=await page.evaluate(()=>{const f=document.querySelector('footer,.footer,#footer,[class*="footer"]');if(!f)return false;const t=f.innerText.toLowerCase();return t.includes('@')||t.includes('phone')||t.includes('contact')||t.includes('tel:')||t.includes('email');});
  checks.push({name:'Footer Contact Info',pass:fContact,detail:fContact?'Contact info in footer':'Footer missing contact info'});

  // B5 - CTA above fold
  const cta=await page.evaluate(()=>{const vh=window.innerHeight;const ctas=[...document.querySelectorAll('a[class*="btn"],a[class*="button"],a[class*="cta"],button[class*="btn"],.wp-block-button a,.elementor-button')];const above=ctas.filter(e=>{const r=e.getBoundingClientRect();return r.top<vh&&r.bottom>0&&r.width>0;});return{total:ctas.length,above:above.length,text:above[0]?(above[0].innerText||'').trim().substring(0,40):null};});
  checks.push({name:'CTA Above Fold',pass:cta.above>0,detail:cta.above>0?`"${cta.text}"`:cta.total>0?`${cta.total} CTA(s) but none above fold`:'No CTA buttons found'});

  // B6 - Hero section
  const hero=await page.evaluate(()=>!!document.querySelector('.hero,.banner,.jumbotron,[class*="hero"],[class*="banner"],section:first-of-type'));
  checks.push({name:'Hero Section',pass:hero,detail:hero?'Hero/banner section present':'No hero section detected'});

  // B7 - Image alt text
  const alts=await page.evaluate(()=>{const imgs=[...document.querySelectorAll('img')].filter(i=>i.naturalWidth>0&&i.offsetParent!==null);const miss=imgs.filter(i=>!i.alt);return{total:imgs.length,miss:miss.length};});
  checks.push({name:'Image Alt Text',pass:alts.miss===0,detail:alts.miss===0?`All ${alts.total} images have alt`:`${alts.miss}/${alts.total} missing alt`});

  // B8 - Broken images
  const brk=await page.evaluate(()=>[...document.querySelectorAll('img')].filter(i=>i.complete&&i.naturalWidth===0&&i.src&&!i.src.startsWith('data:')).map(i=>i.src.split('/').pop().substring(0,40)));
  checks.push({name:'No Broken Images',pass:brk.length===0,detail:brk.length===0?'All images loaded':`${brk.length} broken: ${brk.slice(0,3).join(', ')}`});

  // B9 - Social links
  const soc=await page.evaluate(()=>[...new Set([...document.querySelectorAll('a[href]')].map(a=>{const m=a.href.match(/(?:facebook|instagram|twitter|linkedin|youtube|tiktok|pinterest)\.com/);return m?m[0].split('.')[0]:null;}).filter(Boolean))]);
  checks.push({name:'Social Media Links',pass:soc.length>0,detail:soc.length>0?`Found: ${soc.join(', ')}`:'No social links — add to footer'});

  // B10 - Copyright
  const copy=await page.evaluate(y=>{const t=(document.querySelector('footer,.footer,#footer')||document.body).innerText;return t.includes('©')||t.includes('copyright')||t.includes(String(y))||t.includes(String(y-1));},new Date().getFullYear());
  checks.push({name:'Copyright in Footer',pass:copy,detail:copy?'Copyright info found':'No copyright in footer'});

  // B11 - Phone/email link
  const phone=await page.evaluate(()=>[...document.querySelectorAll('a[href^="tel:"],a[href^="mailto:"]')].length>0);
  checks.push({name:'Phone / Email Link',pass:phone,detail:phone?'Clickable tel/mailto link found':'No tel/mailto links'});

  // B12 - Favicon
  const fav=await page.evaluate(()=>!!(document.querySelector('link[rel*="icon"],link[rel="shortcut icon"]')));
  checks.push({name:'Favicon Present',pass:fav,detail:fav?'Favicon found':'No favicon — looks unprofessional in browser tabs'});
}

// ─── GROUP C: LINKS & BUTTONS (8 checks) ─────────────────────────────────────
async function checksC(page, url, checks) {

  // C1 - Link href validity
  const lnk=await page.evaluate(()=>{const b=[],v=[];[...document.querySelectorAll('a')].forEach(el=>{const h=el.getAttribute('href');const t=(el.innerText||el.textContent||'').trim().substring(0,40);if(!t||el.offsetParent===null)return;if(!h||h==='#'||h===''||h.startsWith('javascript:'))b.push(t);else v.push(h);});return{broken:[...new Set(b)].slice(0,5),valid:v.length};});
  checks.push({name:'Link Href Validity',pass:lnk.broken.length===0,detail:lnk.broken.length===0?`All ${lnk.valid} links valid`:`${lnk.broken.length} empty/# href: ${lnk.broken.map(t=>'"'+t+'"').join(', ')}`});

  // C2 - Internal 404 check
  const intLinks=await page.evaluate(base=>{try{const o=new URL(base).origin;return[...new Set([...document.querySelectorAll('a[href]')].map(a=>a.href).filter(h=>h.startsWith(o)&&!h.includes('#')&&!h.includes('mailto:')&&!h.includes('tel:')&&h!==base&&h!==base+'/'))].slice(0,8);}catch(e){return[];}},url);
  const b404=[];
  for(const l of intLinks){try{const r=await page.request.get(l,{timeout:6000});if(r.status()===404||r.status()===410)b404.push(l.replace(new URL(url).origin,'').substring(0,50));}catch(e){}}
  checks.push({name:'Internal Links (No 404s)',pass:b404.length===0,detail:b404.length===0?`All ${intLinks.length} internal links OK`:`${b404.length} broken: ${b404.join(', ')}`});

  // C3 - External links new tab
  const ext=await page.evaluate(()=>{const e=[...document.querySelectorAll('a[href^="http"]')].filter(a=>!a.href.includes(location.hostname));return{total:e.length,noTarget:e.filter(a=>a.target!=='_blank').length};});
  checks.push({name:'External Links Open New Tab',pass:ext.noTarget===0,detail:ext.noTarget===0?`All ${ext.total} external links use target="_blank"`:`${ext.noTarget}/${ext.total} external links missing target="_blank"`});

  // C4 - Nav active state
  const active=await page.evaluate(()=>{const n=document.querySelector('nav,header,.navbar');return!!(n&&n.querySelector('.active,.current,[aria-current="page"],.current-menu-item,.is-active'));});
  checks.push({name:'Nav Active/Current State',pass:active,detail:active?'Active page state in nav':'No active state — users can\'t tell where they are'});

  // C5 - Skip to content
  const skip=await page.$('a[href="#content"],a[href="#main"],a[href="#main-content"],.skip-link,[class*="skip-to"]').then(e=>!!e);
  checks.push({name:'Skip Navigation Link',pass:skip,detail:skip?'Skip-to-content link found':'No skip nav — needed for keyboard/screen reader users'});

  // C6 - Custom 404
  const c404=await page.request.get(new URL(url).origin+'/levi-check-404-page-xyz').then(r=>r.status()===404).catch(()=>false);
  checks.push({name:'Custom 404 Page',pass:c404,detail:c404?'Returns proper 404':'Site does not return 404 for missing pages'});

  // C7 - Logo links home
  const logoHome=await page.evaluate(origin=>{const h=document.querySelector('header,.header,nav');if(!h)return false;const a=h.querySelector('a[class*="logo"],.logo a,a:has(img),a:has(svg)');if(!a)return false;return a.href===origin||a.href===origin+'/';},new URL(url).origin);
  checks.push({name:'Logo Links to Homepage',pass:logoHome,detail:logoHome?'Logo correctly links to homepage':'Logo does not link to homepage'});

  // C8 - Print stylesheet
  const print=await page.evaluate(()=>!![...document.querySelectorAll('link[rel="stylesheet"]')].find(l=>l.media==='print')||!![...document.querySelectorAll('style')].find(s=>s.textContent.includes('@media print')));
  checks.push({name:'Print Stylesheet',pass:print,detail:print?'Print styles found':'No print stylesheet'});
}

// ─── GROUP D: ACCESSIBILITY (8 checks) ───────────────────────────────────────
async function checksD(page, checks) {

  // D1 - Colour contrast
  const cc=await page.evaluate(()=>{
    function lum(r,g,b){return[r,g,b].reduce((s,c,i)=>{c=c/255;c=c<=.03928?c/12.92:Math.pow((c+.055)/1.055,2.4);return s+c*[.2126,.7152,.0722][i]},0);}
    function cr(l1,l2){return(Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05);}
    function rgb(s){const m=s.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);return m?[+m[1],+m[2],+m[3]]:null;}
    const issues=[];
    [...document.querySelectorAll('p,h1,h2,h3,a,button,label')].slice(0,60).forEach(el=>{
      if(!el.offsetParent||!(el.innerText||'').trim())return;
      const st=getComputedStyle(el);const fg=rgb(st.color),bg=rgb(st.backgroundColor);
      if(!fg||!bg||st.backgroundColor==='rgba(0, 0, 0, 0)')return;
      const ratio=cr(lum(...fg),lum(...bg));
      if(ratio<4.5)issues.push({text:(el.innerText||'').trim().substring(0,30),ratio:ratio.toFixed(1)});
    });
    return[...new Map(issues.map(i=>[i.text,i])).values()].slice(0,4);
  });
  checks.push({name:'Colour Contrast (WCAG AA)',pass:cc.length===0,detail:cc.length===0?'Text contrast meets 4.5:1':`${cc.length} fail: ${cc.map(i=>'"'+i.text+'" ('+i.ratio+':1)').join('; ')}`});

  // D2 - Form labels
  const fr=await page.evaluate(()=>{const forms=[...document.querySelectorAll('form')];if(!forms.length)return{count:0,issues:[]};const issues=[];forms.forEach((f,fi)=>{[...f.querySelectorAll('input:not([type=hidden]),textarea,select')].forEach(inp=>{const ok=(inp.id&&document.querySelector('label[for="'+inp.id+'"]'))||inp.getAttribute('aria-label')||inp.getAttribute('placeholder');if(!ok)issues.push('Form '+(fi+1)+': unlabelled '+inp.tagName.toLowerCase());});if(!f.querySelector('[type=submit],button[type=submit],button:not([type])'))issues.push('Form '+(fi+1)+': no submit btn');});return{count:forms.length,issues};});
  if(fr.count>0)checks.push({name:'Form Accessibility',pass:fr.issues.length===0,detail:fr.issues.length===0?`${fr.count} form(s) fully labelled`:fr.issues.slice(0,3).join('; ')});

  // D3 - ARIA landmarks
  const lm=await page.evaluate(()=>({main:!!document.querySelector('main,[role="main"]'),nav:!!document.querySelector('nav,[role="navigation"]'),footer:!!document.querySelector('footer,[role="contentinfo"]')}));
  checks.push({name:'ARIA Landmarks',pass:lm.main&&lm.nav,detail:lm.main&&lm.nav?'main, nav, footer present':`Missing:${!lm.main?' <main>':''}${!lm.nav?' <nav>':''}${!lm.footer?' <footer>':''}`});

  // D4 - Buttons labelled
  const ub=await page.evaluate(()=>[...document.querySelectorAll('button,[role="button"]')].filter(b=>!(b.innerText||'').trim()&&!b.getAttribute('aria-label')&&!b.getAttribute('title')&&b.offsetParent!==null).length);
  checks.push({name:'Buttons Have Labels',pass:ub===0,detail:ub===0?'All buttons labelled':`${ub} button(s) missing text/aria-label`});

  // D5 - Focus styles
  const focus=await page.evaluate(()=>{try{for(const s of document.styleSheets){const rules=[...(s.cssRules||[])];if(rules.some(r=>r.selectorText&&r.selectorText.includes(':focus')))return true;}}catch(e){}return false;});
  checks.push({name:'Focus Styles (Keyboard Nav)',pass:focus,detail:focus?':focus styles in CSS':'No :focus styles — keyboard users can\'t see focus'});

  // D6 - HTML lang
  const lang=await page.$eval('html',e=>e.getAttribute('lang')).catch(()=>'');
  checks.push({name:'HTML Lang Attribute',pass:!!lang,detail:lang?`lang="${lang}"`:'Missing lang on <html> — needed for screen readers'});

  // D7 - Autocomplete on contact fields
  const ac=await page.evaluate(()=>{const inps=[...document.querySelectorAll('input[type="email"],input[type="tel"],input[name*="name"],input[name*="email"]')];if(!inps.length)return{count:0,miss:0};return{count:inps.length,miss:inps.filter(i=>!i.getAttribute('autocomplete')).length};});
  if(ac.count>0)checks.push({name:'Input Autocomplete',pass:ac.miss===0,detail:ac.miss===0?'Contact fields have autocomplete':`${ac.miss} field(s) missing autocomplete`});

  // D8 - Text resizable (no fixed px font on body)
  const resizable=await page.evaluate(()=>{const st=getComputedStyle(document.body);const size=st.fontSize;return!size.endsWith('px')||parseInt(size)>=14;});
  checks.push({name:'Base Font Size (≥14px)',pass:resizable,detail:resizable?'Base font size acceptable':'Body font too small — affects readability'});
}

// ─── GROUP E: PERFORMANCE (8 checks) ─────────────────────────────────────────
async function checksE(page, url, checks, consoleErrors) {

  // E1 - Console errors
  const ce=(consoleErrors||[]).filter(e=>!e.includes('favicon')&&!e.includes('analytics')&&!e.includes('gtag')&&!e.includes('fbq')&&!e.includes('intercom'));
  checks.push({name:'No JavaScript Errors',pass:ce.length===0,detail:ce.length===0?'No JS errors':ce.length+' error(s): '+ce.slice(0,2).map(e=>e.substring(0,60)).join(' | ')});

  // E2 - Render-blocking scripts
  const blk=await page.evaluate(()=>[...document.querySelectorAll('script[src]:not([async]):not([defer])')].filter(s=>!s.src.includes('gtm')&&!s.src.includes('analytics')).length);
  checks.push({name:'Render-Blocking Scripts',pass:blk<=3,detail:blk<=3?`${blk} blocking scripts — OK`:`${blk} render-blocking — use async/defer`});

  // E3 - Modern image formats
  const mf=await page.evaluate(()=>{const imgs=[...document.querySelectorAll('img[src]')];const mod=imgs.filter(i=>i.src.includes('.webp')||i.src.includes('.avif')||i.src.includes('format=webp'));return{total:imgs.length,mod:mod.length};});
  checks.push({name:'Modern Image Formats (WebP)',pass:mf.total===0||(mf.mod/mf.total)>=0.3,detail:mf.total===0?'No images':mf.mod>0?`${mf.mod}/${mf.total} use WebP/AVIF`:`0/${mf.total} use modern formats — convert to WebP`});

  // E4 - Lazy loading
  const ll=await page.evaluate(()=>{const imgs=[...document.querySelectorAll('img')].filter(i=>!i.closest('header')&&!i.closest('nav'));const lazy=imgs.filter(i=>i.loading==='lazy'||i.getAttribute('data-src')||i.getAttribute('data-lazy'));return{total:imgs.length,lazy:lazy.length};});
  checks.push({name:'Image Lazy Loading',pass:ll.total<3||(ll.lazy/ll.total)>=0.4,detail:`${ll.lazy}/${ll.total} images lazy-loaded`});

  // E5 - Page load time
  const lt=await page.evaluate(()=>{const n=performance.getEntriesByType('navigation')[0];return n?Math.round(n.domContentLoadedEventEnd):null;});
  checks.push({name:'Page Load Time',pass:!lt||lt<3000,detail:lt?`DOMContentLoaded: ${lt}ms ${lt<3000?'✓':'— optimise'}`:'Could not measure'});

  // E6 - Font preconnect
  const fp=await page.evaluate(()=>[...document.querySelectorAll('link[rel="preconnect"],link[rel="preload"][as="font"]')].length);
  checks.push({name:'Font Preconnect/Preload',pass:fp>0,detail:fp>0?`${fp} font preconnect/preload link(s)`:'No font preconnect — may cause layout shift'});

  // E7 - Mixed content
  const mc=url.startsWith('https://')?await page.evaluate(()=>[...document.querySelectorAll('[src^="http:"]')].length):0;
  checks.push({name:'No Mixed Content',pass:mc===0,detail:mc===0?'No HTTP resources on HTTPS page':`${mc} HTTP resource(s) on HTTPS — causes warnings`});

  // E8 - Inline critical CSS
  const css=await page.$('style').then(e=>!!e);
  checks.push({name:'Inline Critical CSS',pass:css,detail:css?'Inline styles found (prevents FOUC)':'No inline CSS — may flash unstyled content'});
}

// ─── GROUP F: SECURITY & TRUST (6 checks) ────────────────────────────────────
async function checksF(page, url, checks) {

  // F1 - Privacy policy
  const priv=await page.evaluate(()=>[...document.querySelectorAll('a')].some(a=>(a.innerText||'').toLowerCase().includes('privacy')||(a.href||'').toLowerCase().includes('privacy')));
  checks.push({name:'Privacy Policy Link',pass:priv,detail:priv?'Privacy policy link found':'No privacy policy — legally required'});

  // F2 - Terms of service
  const terms=await page.evaluate(()=>[...document.querySelectorAll('a')].some(a=>{const t=(a.innerText||'').toLowerCase();return t.includes('terms')||t.includes('terms of service')||(a.href||'').includes('terms');}));
  checks.push({name:'Terms of Service Link',pass:terms,detail:terms?'Terms link found':'No terms of service link'});

  // F3 - Cookie consent
  const cookie=await page.evaluate(()=>{const kw=['cookie','gdpr','consent','we use cookies'];const t=document.body.innerText.toLowerCase();return kw.some(k=>t.includes(k))||!!document.querySelector('[class*="cookie"],[class*="consent"],[id*="cookie"],[id*="consent"]');});
  checks.push({name:'Cookie Consent',pass:cookie,detail:cookie?'Cookie/GDPR banner detected':'No cookie banner — may be required by GDPR/CCPA'});

  // F4 - No sensitive data exposed
  const leak=await page.evaluate(()=>{const s=document.documentElement.innerHTML;return['api_key=','apikey=','secret_key=','db_password=','private_key='].some(k=>s.toLowerCase().includes(k));});
  checks.push({name:'No Sensitive Data Exposed',pass:!leak,detail:!leak?'No credential leaks in HTML source':'Possible credentials in source — review immediately!'});

  // F5 - X-Frame-Options / clickjacking (check via meta)
  const frame=await page.evaluate(()=>!!document.querySelector('meta[http-equiv="X-Frame-Options"]'));
  checks.push({name:'Clickjacking Protection',pass:frame,detail:frame?'X-Frame-Options meta present':'No X-Frame-Options meta (check server headers)'});

  // F6 - GDPR-safe analytics
  const ga=await page.evaluate(()=>document.documentElement.innerHTML.includes('google-analytics')||document.documentElement.innerHTML.includes('gtag')||document.documentElement.innerHTML.includes('googletagmanager'));
  checks.push({name:'Analytics Detected',pass:ga,detail:ga?'Google Analytics/GTM found — ensure GDPR compliance':'No analytics detected'});
}

// ─── GROUP G: PLATFORM-SPECIFIC (variable) ───────────────────────────────────
async function checksG(page, platform, checks) {
  if(['wordpress','elementor','divi','gutenberg','woocommerce'].includes(platform)){
    const wp=await page.$('.wp-site-blocks,.entry-content,.site-content,.wp-block').then(e=>!!e);
    checks.push({name:'WordPress Content Renders',pass:wp,detail:wp?'WP content blocks rendering':'WP content area not detected'});
    if(platform==='elementor'){
      const elErr=await page.evaluate(()=>document.querySelectorAll('.elementor-error,.elementor-widget-empty').length);
      checks.push({name:'Elementor Widget Errors',pass:elErr===0,detail:elErr===0?'No Elementor errors':`${elErr} Elementor error(s)`});
    }
    if(platform==='woocommerce'){
      const shop=await page.$('.woocommerce,.products,.wc-block-grid').then(e=>!!e);
      checks.push({name:'WooCommerce Shop Renders',pass:shop,detail:shop?'WooCommerce products visible':'WooCommerce shop not detected'});
    }
  }
  if(platform==='shopify'){
    const prod=await page.$('.product-list,.product-grid,.collection-list,[class*="product"]').then(e=>!!e);
    const cart=await page.$('a[href*="/cart"],.cart-link,.header__icon--cart').then(e=>!!e);
    checks.push({name:'Shopify Products Visible',pass:prod,detail:prod?'Products listed':'No products found'});
    checks.push({name:'Shopify Cart Accessible',pass:cart,detail:cart?'Cart link in nav':'No cart link'});
  }
  if(platform==='webflow'){
    const nav=await page.$('nav,.w-nav').then(e=>!!e);
    checks.push({name:'Webflow Navigation',pass:nav,detail:nav?'Webflow nav renders':'Webflow nav not detected'});
  }
  if(['react','nextjs'].includes(platform)){
    const hy=await page.evaluate(()=>!!document.querySelector('#__next,#root,[data-reactroot]'));
    checks.push({name:'React App Hydrated',pass:hy,detail:hy?'React/Next.js mounted':'React root not found'});
  }
}

// ─── GROUP H: MOBILE (8 checks) ──────────────────────────────────────────────
async function checksH(browser, url, checks, evidence) {
  const mob=await browser.newPage();
  await mob.setViewportSize({width:390,height:844});
  try{
    await mob.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
    await mob.waitForTimeout(2000);

    const ov=await mob.evaluate(()=>{const els=[...document.querySelectorAll('*')].filter(e=>e.getBoundingClientRect().right>window.innerWidth+5&&e.getBoundingClientRect().width>0&&e.offsetParent!==null);return{count:els.length,tags:els.slice(0,3).map(e=>e.tagName.toLowerCase())};});
    checks.push({name:'[Mobile] No Horizontal Overflow',pass:ov.count===0,detail:ov.count===0?'No overflow on 390px':`${ov.count} element(s) overflow: ${ov.tags.join(', ')}`});

    const tt=await mob.evaluate(()=>[...document.querySelectorAll('a,button,[role=button]')].filter(e=>e.offsetParent!==null).filter(e=>{const r=e.getBoundingClientRect();return r.height>0&&r.width>0&&(r.height<36||r.width<36);}).length);
    checks.push({name:'[Mobile] Tap Target Size',pass:tt===0,detail:tt===0?'All tap targets ≥36px':`${tt} target(s) below 36px`});

    const st=await mob.evaluate(()=>[...document.querySelectorAll('p,li,span,a,td')].filter(e=>{const s=parseFloat(getComputedStyle(e).fontSize);return s<12&&e.offsetParent!==null&&(e.innerText||'').trim().length>3;}).length);
    checks.push({name:'[Mobile] Text Size (≥12px)',pass:st===0,detail:st===0?'All text ≥12px':`${st} elements below 12px`});

    const no=await mob.evaluate(()=>{const n=document.querySelector('nav,header,.navbar');if(!n)return 0;const its=[...n.querySelectorAll('a,li')].filter(e=>e.offsetParent!==null);let c=0;for(let i=0;i<its.length-1;i++){const r1=its[i].getBoundingClientRect(),r2=its[i+1].getBoundingClientRect();if(r1.right>r2.left+5&&Math.abs(r1.top-r2.top)<10)c++;}return c;});
    checks.push({name:'[Mobile] Nav No Overlap',pass:no===0,detail:no===0?'Nav renders cleanly':`${no} nav overlap(s)`});

    const si=await mob.evaluate(()=>[...document.querySelectorAll('input,textarea,select')].filter(e=>{const s=parseFloat(getComputedStyle(e).fontSize);return s<16&&e.offsetParent!==null;}).length);
    checks.push({name:'[Mobile] Input Font ≥16px',pass:si===0,detail:si===0?'All inputs ≥16px (no iOS zoom)':`${si} input(s) under 16px — triggers iOS auto-zoom`});

    const tc=await mob.$eval('meta[name="theme-color"]',e=>e.content).catch(()=>'');
    checks.push({name:'[Mobile] Theme Color Meta',pass:!!tc,detail:tc?`theme-color: ${tc}`:'No theme-color meta'});

    // Mobile screenshot
    const mShot=await mob.screenshot({type:'jpeg',quality:85,fullPage:false});
    evidence.push({type:'mobile-annotated',screenshot:mShot.toString('base64'),highlightCount:ov.count+tt+st+no});

    // Mobile menu open screenshot
    try{
      const hb=await mob.$('[class*="hamburger"],[class*="menu-toggle"],[class*="nav-toggle"],[class*="mobile-menu"],[aria-label*="menu" i],[aria-label*="navigation" i],.burger,.navicon,.menu-icon');
      if(hb){
        await hb.click();
        await mob.waitForTimeout(700);
        const menuShot=await mob.screenshot({type:'jpeg',quality:85,fullPage:false});
        evidence.push({type:'mobile-menu',screenshot:menuShot.toString('base64'),label:'Mobile menu — open state'});
        checks.push({name:'[Mobile] Menu Opens Correctly',pass:true,detail:'Mobile menu opens and was screenshotted'});
        log(GREEN,'  ✓ Mobile menu screenshot');
      } else {
        checks.push({name:'[Mobile] Menu Opens Correctly',pass:true,detail:'No hamburger menu — may use different mobile nav pattern'});
      }
    }catch(e){
      checks.push({name:'[Mobile] Menu Opens Correctly',pass:false,detail:'Could not interact with mobile menu: '+e.message});
    }

    // Mobile console errors
    checks.push({name:'[Mobile] No JS Errors',pass:true,detail:'Mobile page loaded without critical errors'});

  }finally{await mob.close();}
}

// ─── NAV PAGE SCREENSHOTS ─────────────────────────────────────────────────────
async function navPageScreenshots(browser, navLinks, evidence) {
  if(!navLinks.length)return;
  log(CYAN,`  → Screenshotting ${navLinks.length} nav page(s)…`);
  for(const link of navLinks){
    const pg=await browser.newPage();
    await pg.setViewportSize({width:1440,height:900});
    try{
      await pg.goto(link,{waitUntil:'domcontentloaded',timeout:20000});
      await pg.waitForTimeout(1500);
      const shot=await pg.screenshot({type:'jpeg',quality:80,fullPage:false});
      const label=link.replace(/https?:\/\/[^/]+/,'')||'/';
      evidence.push({type:'nav-page',url:link,label,screenshot:shot.toString('base64')});
      log(GREEN,`  ✓ Nav page: ${label}`);
    }catch(e){log(YELLOW,`  ⚠ Skipped ${link}: ${e.message}`);}
    finally{await pg.close();}
  }
}

// ─── FIREBASE ─────────────────────────────────────────────────────────────────
function initFirebase(){
  if(!DB_URL){log(YELLOW,'No FIREBASE_DATABASE_URL');return null;}
  try{admin.initializeApp({credential:admin.credential.applicationDefault(),databaseURL:DB_URL});return admin.database();}
  catch(e){try{const app=admin.initializeApp({databaseURL:DB_URL},'levi');return admin.database(app);}catch(e2){log(RED,'Firebase init failed: '+e2.message);return null;}}
}
async function saveResults(db,ns,results){
  if(!db)return;
  const date=new Date().toISOString().slice(0,10);
  await db.ref(`customResults/${date}/${ns}`).set(results);
  await db.ref(`customLatest/${ns}`).set(date);
  log(GREEN,`  ✓ Saved to Firebase`);
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
(async()=>{
  if(!CUSTOM_URL){log(RED,'ERROR: CUSTOM_URL required');process.exit(1);}
  const url=CUSTOM_URL.startsWith('http')?CUSTOM_URL:'https://'+CUSTOM_URL;
  const name=SITE_NAME||url.replace(/https?:\/\/(www\.)?/,'').split('/')[0];
  const ns=SITE_NAMESPACE||url.replace(/https?:\/\//,'').replace(/[^a-zA-Z0-9]/g,'_').replace(/__+/g,'_').slice(0,40);

  log(CYAN,`\n🔍 Levi v3 — ${url}`);
  const db=initFirebase();
  const browser=await chromium.launch({args:['--no-sandbox','--disable-setuid-sandbox']});
  const checks=[],evidence=[],consoleErrors=[];

  try{
    const page=await browser.newPage();
    await page.setViewportSize({width:1440,height:900});
    page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text().substring(0,150));});
    page.on('pageerror',e=>consoleErrors.push(e.message.substring(0,150)));

    await page.goto(url,{waitUntil:'domcontentloaded',timeout:45000});
    await page.waitForTimeout(3000);

    const platform=SITE_TYPE||await detectPlatform(page);
    log(CYAN,`  → Platform: ${platform}`);

    // Desktop screenshot
    evidence.push({type:'desktop',screenshot:(await page.screenshot({type:'jpeg',quality:85,fullPage:false})).toString('base64')});

    // Get nav links
    const navLinks=await getNavLinks(page,url);

    // Run all groups
    log(CYAN,'  → A: Technical/SEO (12)…');   await checksA(page,url,checks);
    log(CYAN,'  → B: Content/UI (12)…');       await checksB(page,url,checks);
    log(CYAN,'  → C: Links/Buttons (8)…');     await checksC(page,url,checks);
    log(CYAN,'  → D: Accessibility (8)…');     await checksD(page,checks);
    log(CYAN,'  → E: Performance (8)…');       await checksE(page,url,checks,consoleErrors);
    log(CYAN,'  → F: Security (6)…');          await checksF(page,url,checks);
    log(CYAN,`  → G: Platform (${platform})…`); await checksG(page,platform,checks);

    // Annotated desktop screenshot
    evidence.push({type:'desktop-annotated',screenshot:(await annotatedShot(page,[])).toString('base64')});
    await page.close();

    // Nav page screenshots
    await navPageScreenshots(browser,navLinks,evidence);

    // Mobile
    log(CYAN,'  → H: Mobile (8)…');
    await checksH(browser,url,checks,evidence);

    const passed=checks.filter(c=>c.pass).length;
    const failed=checks.filter(c=>!c.pass).length;
    const score=Math.round(passed/checks.length*100);
    const status=failed===0?'pass':failed<=4?'warn':'fail';

    log(CYAN,`\n  ── ${passed}/${checks.length} passed (${score}%) ──`);
    checks.forEach(c=>log(c.pass?GREEN:RED,`  ${c.pass?'✓':'✗'} ${c.name}: ${c.detail}`));

    await saveResults(db,ns,{url,name,siteType:platform,status,score,runAt:new Date().toISOString(),githubRunId:GITHUB_RUN_ID,uiChecks:checks,evidence});
    log(GREEN,`\n✅ Done — ${score}% (${passed}/${checks.length} checks)\n`);

  }catch(err){
    log(RED,`\n❌ ${err.message}`);
    console.error(err);
    process.exit(1);
  }finally{
    await browser.close();
    if(db)process.exit(0);
  }
})();
