/**
 * QA Smoke Test Agent
 * Runs daily via GitHub Actions, tests all client sites with AI vision analysis,
 * writes results to Firebase. Only reports MAJOR failures.
 */

const { chromium } = require('playwright');
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');

// ── Config ────────────────────────────────────────────────────────
const FIREBASE_URL = process.env.FIREBASE_DATABASE_URL;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const SINGLE_SITE = process.env.SINGLE_SITE || '';
const SCREENSHOT_DIR = '/tmp/qa-screenshots';

if (!FIREBASE_URL) { console.error('❌ FIREBASE_DATABASE_URL not set'); process.exit(1); }
if (!ANTHROPIC_KEY) { console.error('❌ ANTHROPIC_API_KEY not set'); process.exit(1); }

const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY });

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

// ── Sites ─────────────────────────────────────────────────────────
const SITES = [
  { id: 'pantry',     name: 'Pantry Packers',         url: 'https://give.pantrypackers.org/' },
  { id: 'israelthon', name: 'Israelthon',              url: 'https://israelthon.org/' },
  { id: 'yorkville',  name: 'Yorkville Jewish Centre', url: 'https://donate.yorkvillejewishcentre.com/' },
  { id: 'chaiathon',  name: 'Chaiathon',               url: 'https://chaiathon.org' },
  { id: 'fcl',        name: 'Chai Lifeline USA',        url: 'https://fundraise.chailifeline.org' },
  { id: 'uh',         name: 'United Hatzalah',          url: 'https://israelrescue.org' },
  { id: 'clc',        name: 'Chai Lifeline Canada',     url: 'https://fundraise.chailifelinecanada.org' },
  { id: 'afmda',      name: 'AFMDA',                   url: 'https://crowdfund.afmda.org' },
  { id: 'misaskim',   name: 'Misaskim',                url: 'https://misaskim.ca' },
  { id: 'mizrachi',   name: 'Mizrachi',                url: 'https://fundraise.mizrachi.ca' },
  { id: 'shomrim',    name: 'Shomrim Toronto',         url: 'https://shomrimtoronto.org' },
  { id: 'fallen',     name: 'Fallen Heroes',           url: 'https://fallenh.org' },
  { id: 'nitzanim',   name: 'Nitzanim',                url: 'https://members.kehilatnitzanim.org/' },
  { id: 'imf',        name: 'Israel Magen Fund',       url: 'https://israelmagenfund.org/' },
  { id: 'adi',        name: 'ADI',                     url: 'https://adi-il.org/' },
  { id: 'yeshiva',    name: 'The Yeshiva',             url: 'https://donate.theyeshiva.net' },
  { id: 'nahal',      name: 'Nahal Haredi',            url: 'https://give.nahalharedi.org/' },
  { id: 'r2bo',       name: 'Race to Bais Olami',      url: 'https://racetobais.olami.org/' },
  { id: 'ots',        name: 'Ohr Torah Stone',         url: 'https://fundraise.ots.org.il/' },
];

// ── Error keywords that indicate MAJOR failures ───────────────────
const ERROR_TITLE_PATTERNS = [
  '404', '403', '500', '502', '503', '504',
  'not found', 'error', 'page not found', 'access denied',
  'forbidden', 'bad gateway', 'service unavailable',
  'internal server error', 'gateway timeout',
];
const ERROR_BODY_PATTERNS = [
  'this site can\'t be reached',
  'err_connection_refused',
  'dns_probe_finished_nxdomain',
  'this page isn\'t working',
  'application error',
  'database connection',
  'fatal error',
  'white screen',
  'under construction',
  'coming soon',
  'parked domain',
  'buy this domain',
  'this domain is for sale',
];

// ── Helpers ───────────────────────────────────────────────────────
function todayDate() {
  return new Date().toISOString().split('T')[0];
}

function log(msg, type = 'info') {
  const icons = { info: '  ', pass: '✅', fail: '❌', warn: '⚠️ ', ai: '🤖' };
  console.log(`${icons[type] || '  '} ${msg}`);
}

async function writeToFirebase(path, data) {
  const url = `${FIREBASE_URL}/${path}.json`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Firebase write failed: ${res.status} ${text}`);
  }
  return res.json();
}

async function readFromFirebase(path) {
  const url = `${FIREBASE_URL}/${path}.json`;
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.json();
}

// ── AI Analysis ───────────────────────────────────────────────────
async function analyzeScreenshot(screenshotBase64, site) {
  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/jpeg',
              data: screenshotBase64,
            },
          },
          {
            type: 'text',
            text: `You are a QA agent checking the website "${site.name}" (${site.url}).

Examine this screenshot and identify ONLY critical functional failures that would prevent users from using the site.

REPORT as failures:
- Completely blank or white page with no content
- HTTP error pages (404, 500, 503, etc.)
- "This site can't be reached" or DNS failure messages  
- Domain parking / "buy this domain" pages
- "Coming soon" or "Under construction" placeholder pages
- Database or server error messages visible on page
- The page appears to be a completely wrong site/content
- Login wall showing where a public page should be accessible

DO NOT REPORT as failures (ignore these completely):
- Different text content or copy changes
- Updated images, banners, or photos
- New campaigns or fundraising amounts
- Minor layout or styling differences
- Cookie consent banners or popups
- Different fonts or colours
- Countdown timers, overlays, modals for current campaigns
- Normal page variations for a charity/fundraising website

Respond ONLY with valid JSON, no other text:
{
  "passing": true or false,
  "majorIssues": ["brief description of each major issue found"],
  "pageDescription": "one sentence describing what you see on the page"
}`,
          },
        ],
      }],
    });

    const text = response.content[0]?.text || '{}';
    const cleaned = text.replace(/```json|```/g, '').trim();
    return JSON.parse(cleaned);
  } catch (err) {
    log(`AI analysis error for ${site.name}: ${err.message}`, 'warn');
    return {
      passing: null,
      majorIssues: [],
      pageDescription: 'AI analysis failed — manual check required',
      error: err.message,
    };
  }
}

// ── Core site tester ──────────────────────────────────────────────
async function testSite(browser, site) {
  log(`Testing ${site.name} (${site.url})...`);

  const result = {
    id: site.id,
    name: site.name,
    url: site.url,
    runAt: new Date().toISOString(),
    status: 'pass',
    checks: {},
    majorFailures: [],
    aiAnalysis: null,
  };

  let context;
  try {
    context = await browser.newContext({
      ignoreHTTPSErrors: true,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1440, height: 900 },
    });

    const page = await context.newPage();

    // ── 1. HTTP response check ──
    let httpStatus = 0;
    try {
      const startTime = Date.now();
      const response = await page.goto(site.url, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      httpStatus = response ? response.status() : 0;
      const loadMs = Date.now() - startTime;

      result.checks.httpStatus = { pass: httpStatus < 400, value: httpStatus };
      result.checks.loadTimeMs = { pass: true, value: loadMs };

      if (httpStatus >= 400) {
        result.majorFailures.push(`HTTP ${httpStatus} error response`);
      }
    } catch (navErr) {
      result.checks.httpStatus = { pass: false, error: navErr.message };
      result.majorFailures.push(`Page failed to load: ${navErr.message.split('\n')[0]}`);
      result.status = 'error';

      // Still take screenshot even on nav error
      try {
        const ss = await page.screenshot({ type: 'jpeg', quality: 60 });
        const b64 = ss.toString('base64');
        const ai = await analyzeScreenshot(b64, site);
        result.aiAnalysis = ai;
        if (!ai.passing && ai.majorIssues?.length > 0) {
          result.majorFailures.push(...ai.majorIssues);
        }
      } catch {}

      await context.close();
      return result;
    }

    // ── 2. Wait for JS to settle ──
    try {
      await page.waitForLoadState('networkidle', { timeout: 10000 });
    } catch { /* timeout is ok, continue */ }
    await page.waitForTimeout(2000);

    // ── 3. Page title check ──
    const title = await page.title().catch(() => '');
    const titleLower = title.toLowerCase();
    const titleHasError = ERROR_TITLE_PATTERNS.some(p => titleLower.includes(p));
    result.checks.pageTitle = { pass: !titleHasError && title.length > 0, value: title };
    if (!result.checks.pageTitle.pass) {
      result.majorFailures.push(`Error detected in page title: "${title}"`);
    }

    // ── 4. Body content check ──
    const { bodyText, bodyLength } = await page.evaluate(() => {
      const text = document.body?.innerText || '';
      return { bodyText: text.slice(0, 500).toLowerCase(), bodyLength: text.length };
    }).catch(() => ({ bodyText: '', bodyLength: 0 }));

    result.checks.contentLength = { pass: bodyLength > 300, value: bodyLength };
    if (!result.checks.contentLength.pass) {
      result.majorFailures.push('Page appears blank or has no meaningful content');
    }

    const bodyHasError = ERROR_BODY_PATTERNS.some(p => bodyText.includes(p));
    result.checks.noErrorContent = { pass: !bodyHasError };
    if (!result.checks.noErrorContent.pass) {
      const matched = ERROR_BODY_PATTERNS.find(p => bodyText.includes(p));
      result.majorFailures.push(`Error content found on page: "${matched}"`);
    }

    // ── 5. H1 check ──
    const h1Text = await page.evaluate(() => {
      const h1 = document.querySelector('h1, h2');
      return (h1?.innerText || '').toLowerCase().trim();
    }).catch(() => '');
    const h1HasError = ERROR_TITLE_PATTERNS.some(p => h1Text.includes(p));
    result.checks.h1Content = { pass: !h1HasError, value: h1Text.slice(0, 80) };
    if (!result.checks.h1Content.pass) {
      result.majorFailures.push(`Error heading found: "${h1Text.slice(0, 60)}"`);
    }

    // ── 6. Interactive elements ──
    const interactiveCount = await page.evaluate(() =>
      document.querySelectorAll('button, a[href], input[type=submit], input[type=button]').length
    ).catch(() => 0);
    result.checks.hasInteractiveElements = { pass: interactiveCount > 3, value: interactiveCount };
    if (!result.checks.hasInteractiveElements.pass) {
      result.majorFailures.push(`Almost no interactive elements found (${interactiveCount}) — page may be broken`);
    }

    // ── 7. Fundraising content check ──
    const hasFundraisingContent = await page.evaluate(() => {
      const text = (document.body?.innerText || '').toLowerCase();
      const keywords = ['donate', 'give', 'fund', 'campaign', 'support', 'charity', 'contribute', 'raise', 'tzedakah'];
      return keywords.some(k => text.includes(k));
    }).catch(() => false);
    result.checks.hasFundraisingContent = { pass: hasFundraisingContent };
    if (!hasFundraisingContent && bodyLength > 300) {
      result.majorFailures.push('No fundraising or donation content detected on page — may be showing wrong content');
    }

    // ── 8. Screenshot + AI analysis ──
    try {
      const screenshot = await page.screenshot({
        type: 'jpeg',
        quality: 70,
        fullPage: false,
        clip: { x: 0, y: 0, width: 1440, height: 900 },
      });

      // Save locally (for GitHub Actions artifact upload on failure)
      const ssPath = path.join(SCREENSHOT_DIR, `${site.id}.jpg`);
      fs.writeFileSync(ssPath, screenshot);

      const b64 = screenshot.toString('base64');
      log(`  Running AI analysis...`, 'ai');
      const aiResult = await analyzeScreenshot(b64, site);
      result.aiAnalysis = aiResult;
      log(`  AI: ${aiResult.pageDescription}`, 'ai');

      if (aiResult.passing === false && aiResult.majorIssues?.length > 0) {
        // De-duplicate with programmatic checks
        for (const issue of aiResult.majorIssues) {
          const isDupe = result.majorFailures.some(f =>
            f.toLowerCase().includes(issue.toLowerCase().slice(0, 15))
          );
          if (!isDupe) result.majorFailures.push(`[AI] ${issue}`);
        }
      }
    } catch (ssErr) {
      log(`  Screenshot/AI error: ${ssErr.message}`, 'warn');
      result.aiAnalysis = { passing: null, error: ssErr.message };
    }

  } catch (outerErr) {
    result.majorFailures.push(`Unexpected error: ${outerErr.message}`);
    result.status = 'error';
  } finally {
    if (context) await context.close().catch(() => {});
  }

  result.status = result.majorFailures.length > 0 ? 'fail' : 'pass';

  if (result.status === 'pass') {
    log(`${site.name} — PASSED`, 'pass');
  } else {
    log(`${site.name} — FAILED: ${result.majorFailures.join(' | ')}`, 'fail');
  }

  return result;
}

// ── Main ──────────────────────────────────────────────────────────
async function main() {
  const date = todayDate();
  const runStart = new Date().toISOString();

  console.log('\n══════════════════════════════════════════');
  console.log(`  QA Agent — ${date}`);
  console.log('══════════════════════════════════════════\n');

  // Filter to single site if requested
  const sitesToTest = SINGLE_SITE
    ? SITES.filter(s => s.id === SINGLE_SITE)
    : SITES;

  if (sitesToTest.length === 0) {
    console.error(`No site found with id "${SINGLE_SITE}"`);
    process.exit(1);
  }

  log(`Running ${sitesToTest.length} site(s)...`);

  const browser = await chromium.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  const allResults = {};
  const failures = [];
  let passed = 0;
  let failed = 0;
  let errored = 0;

  for (const site of sitesToTest) {
    try {
      const result = await testSite(browser, site);
      allResults[site.id] = result;

      if (result.status === 'pass') passed++;
      else if (result.status === 'error') errored++;
      else {
        failed++;
        failures.push(result);
      }

      // Write individual result immediately so partial results are visible
      await writeToFirebase(`autoResults/${date}/${site.id}`, result).catch(e =>
        log(`Firebase write failed for ${site.id}: ${e.message}`, 'warn')
      );

      // Stagger requests to be respectful of sites
      if (sitesToTest.indexOf(site) < sitesToTest.length - 1) {
        await new Promise(r => setTimeout(r, 3000));
      }
    } catch (siteErr) {
      log(`Fatal error testing ${site.name}: ${siteErr.message}`, 'fail');
      errored++;
    }
  }

  await browser.close();

  // ── Write summary to Firebase ──
  const summary = {
    date,
    runAt: runStart,
    completedAt: new Date().toISOString(),
    totalSites: sitesToTest.length,
    passed,
    failed,
    errored,
    hasMajorFailures: failures.length > 0,
    failedSites: failures.map(f => ({
      id: f.id,
      name: f.name,
      url: f.url,
      majorFailures: f.majorFailures,
    })),
  };

  await writeToFirebase(`autoSummary/${date}`, summary).catch(e =>
    log(`Failed to write summary: ${e.message}`, 'warn')
  );

  // ── Write latest pointer (dashboard uses this) ──
  await writeToFirebase('autoLatest', { date, ...summary }).catch(() => {});

  // ── Console summary ──
  console.log('\n══════════════════════════════════════════');
  console.log(`  Run complete: ${passed} passed, ${failed} failed, ${errored} errors`);
  console.log('══════════════════════════════════════════');

  if (failures.length > 0) {
    console.log('\n🚨 MAJOR FAILURES:\n');
    for (const f of failures) {
      console.log(`  ${f.name} (${f.url})`);
      for (const issue of f.majorFailures) {
        console.log(`    → ${issue}`);
      }
    }
  } else {
    console.log('\n✅ All sites healthy');
  }

  // Exit with error code if any failures (marks GitHub Action as failed)
  if (failed > 0 || errored > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal runner error:', err);
  process.exit(1);
});
