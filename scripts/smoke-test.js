const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const FIREBASE_URL  = (process.env.FIREBASE_DATABASE_URL || '').replace(/\/$/, '');
const GEMINI_KEY    = process.env.GEMINI_API_KEY || '';
const SINGLE_SITE   = process.env.SINGLE_SITE   || '';
const SCREENSHOT_DIR = '/tmp/qa-screenshots';
const GEMINI_MODEL  = 'gemini-1.5-flash';
const GEMINI_URL    = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`;

if (!FIREBASE_URL) { console.error('FIREBASE_DATABASE_URL is not set'); process.exit(1); }
if (!GEMINI_KEY)   { console.error('GEMINI_API_KEY is not set');         process.exit(1); }

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

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
  if (!res.ok) throw new Error(`Firebase write failed [${res.status}]: ${await res.text()}`);
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

Reply ONLY with valid JSON, nothing else:
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
    if (!res.ok) throw new Error(`Gemini API ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = await res.json();
    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    return {
      passing: Boolean(parsed.passing),
      majorIssues: Array.isArray(parsed.majorIssues) ? parsed.majorIssues : [],
      pageDescription: parsed.pageDescription || 'Analysis complete.',
    };
  } catch (err) {
    log(`  Gemini error for ${site.name}: ${err.message}`, 'warn');
    return { passing: null, majorIssues: [], pageDescription: 'Vision analysis unavailable.', error: err.message };
  }
}

async function testSite(browser, site) {
  log(`Testing ${site.name}...`);
  const result = {
    id: site.id, name: site.name, url: site.url,
    runAt: new Date().toISOString(),
    status: 'pass', checks: {}, majorFailures: [], aiAnalysis: null,
  };

  let context;
  try {
    context = await browser.newContext({
      ignoreHTTPSErrors: true,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();

    // 1. Load page
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

    // 2. Wait to settle
    try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch {}
    await page.waitForTimeout(2000);

    // 3. Title check
    const title = await page.title().catch(() => '');
    const badTitle = ERROR_TITLE_WORDS.some(w => title.toLowerCase().includes(w));
    result.checks.pageTitle = { pass: !badTitle && title.length > 0, value: title };
    if (!result.checks.pageTitle.pass) result.majorFailures.push(`Error in page title: "${title}"`);

    // 4. Body content
    const { bodyLength, bodySnippet } = await page.evaluate(() => {
      const t = document.body?.innerText || '';
      return { bodyLength: t.length, bodySnippet: t.slice(0, 600).toLowerCase() };
    }).catch(() => ({ bodyLength: 0, bodySnippet: '' }));

    result.checks.contentLength = { pass: bodyLength > 300, value: bodyLength };
    if (!result.checks.contentLength.pass) result.majorFailures.push('Page appears blank');

    // 5. Error phrase check
    const errorPhrase = ERROR_BODY_PHRASES.find(p => bodySnippet.includes(p));
    result.checks.noErrorContent = { pass: !errorPhrase };
    if (errorPhrase) result.majorFailures.push(`Error phrase found: "${errorPhrase}"`);

    // 6. Heading check
    const h1 = await page.evaluate(() =>
      (document.querySelector('h1,h2')?.innerText || '').toLowerCase().trim().slice(0, 100)
    ).catch(() => '');
    const badH1 = ERROR_TITLE_WORDS.some(w => h1.includes(w));
    result.checks.heading = { pass: !badH1, value: h1 };
    if (badH1) result.majorFailures.push(`Error heading: "${h1.slice(0, 60)}"`);

    // 7. Interactive elements
    const interactiveCount = await page.evaluate(() =>
      document.querySelectorAll('button,a[href],input[type=submit],input[type=button]').length
    ).catch(() => 0);
    result.checks.interactiveElements = { pass: interactiveCount > 3, value: interactiveCount };
    if (!result.checks.interactiveElements.pass) result.majorFailures.push(`Only ${interactiveCount} interactive elements found`);

    // 8. Fundraising content
    const hasFundraising = ['donate','give','fund','campaign','support','charity','contribute','raise','tzedakah','sponsor']
      .some(k => bodySnippet.includes(k));
    result.checks.fundraisingContent = { pass: hasFundraising };
    if (!hasFundraising && bodyLength > 300) result.majorFailures.push('No fundraising content detected');

    // 9. Screenshot + Gemini
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
  console.log(`  QA Agent (Gemini) — ${date}`);
  console.log('══════════════════════════════════════════\n');

  const sitesToTest = SINGLE_SITE ? SITES.filter(s => s.id === SINGLE_SITE) : SITES;
  if (!sitesToTest.length) { console.error(`No site found: "${SINGLE_SITE}"`); process.exit(1); }
  log(`Running ${sitesToTest.length} sites...`);

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
    totalSites: sitesToTest.length,
    passed, failed, errored,
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
