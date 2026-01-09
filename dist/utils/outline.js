"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.searchTopResults = searchTopResults;
exports.extractHeadings = extractHeadings;
exports.generateOutlineAndIdea = generateOutlineAndIdea;
exports.selectTopResults = selectTopResults;
const cheerio_1 = require("cheerio");

// Prefer SearchAPI.io; fallback to SerpAPI. Throws if both missing or failing.
async function searchTopResults(query, limit = 3) {
  const searchApiKey = (process.env.SEARCHAPI_API_KEY || '').trim();
  if (searchApiKey) {
    const url = `https://www.searchapi.io/api/v1/search?engine=google&hl=en&gl=us&q=${encodeURIComponent(query)}&api_key=${encodeURIComponent(searchApiKey)}`;
    // eslint-disable-next-line no-console
    console.log('[searchapi.io] query=', query, 'key_len=', searchApiKey.length);
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 slackbot', 'Accept': 'application/json' } });
    if (!res.ok) throw new Error(`SearchAPI HTTP ${res.status}`);
    const json = await res.json();
    const org = Array.isArray(json.organic_results) ? json.organic_results : [];
    const results = org.slice(0, limit * 2).map((r) => ({ url: r.link, title: r.title, snippet: r.snippet || '' })).filter((x) => x.url && x.title);
    if (results.length > 0) return results;
    throw new Error('SearchAPI returned no results');
  }
  const serpApiKey = (process.env.SERPAPI_KEY || '').trim();
  if (!serpApiKey) throw new Error('No search provider configured');
  const serpUrl = `https://serpapi.com/search.json?engine=google&hl=en&gl=us&q=${encodeURIComponent(query)}&num=${Math.max(3, limit)}&api_key=${encodeURIComponent(serpApiKey)}`;
  // eslint-disable-next-line no-console
  console.log('[serpapi] query=', query, 'key_len=', serpApiKey.length);
  const serpRes = await fetch(serpUrl, { headers: { 'User-Agent': 'Mozilla/5.0 slackbot', 'Accept': 'application/json' } });
  if (!serpRes.ok) throw new Error(`SerpAPI HTTP ${serpRes.status}`);
  const serpJson = await serpRes.json();
  const serpOrg = Array.isArray(serpJson.organic_results) ? serpJson.organic_results : [];
  const serpResults = serpOrg.slice(0, limit * 2).map((r) => ({ url: r.link, title: r.title, snippet: r.snippet || '' })).filter((x) => x.url && x.title);
  if (serpResults.length === 0) throw new Error('SerpAPI returned no results');
  return serpResults;
}

async function extractHeadings(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 slackbot' } });
    const html = await res.text();
    const $ = (0, cheerio_1.load)(html);
    const title = $('title').first().text().trim();
    const headings = [];
    ['h1', 'h2', 'h3'].forEach((tag) => {
      $(tag).each((_, el) => {
        const text = $(el).text().trim();
        if (text && text.length > 2 && text.length < 160) headings.push({ tag, text });
      });
    });
    const metaStd = $('meta[name="description"]').attr('content') || '';
    const metaOg = $('meta[property="og:description"]').attr('content') || '';
    const metaTw = $('meta[name="twitter:description"]').attr('content') || '';
    // Paragraph fallback (first paragraph-ish up to 320 chars)
    let para = '';
    $('p').each((i, el) => {
      const t = $(el).text().trim();
      if (!para && t && t.length > 50) para = t.slice(0, 320);
    });
    const candidates = [metaStd, metaOg, metaTw, para].filter(Boolean);
    // Prefer the longest non-truncated-looking candidate
    const meta = candidates.sort((a, b) => b.length - a.length)[0] || '';
    return { title, headings, meta };
  } catch (e) {
    return { title: '', headings: [], meta: '' };
  }
}

function pickSections(headings) {
  // naive grouping: prefer h2s as sections, h3s as bullets
  const sections = [];
  let current = null;
  for (const h of headings) {
    if (h.tag === 'h1' && !current) {
      current = { title: h.text, bullets: [] };
      sections.push(current);
    } else if (h.tag === 'h2') {
      current = { title: h.text, bullets: [] };
      sections.push(current);
    } else if (h.tag === 'h3' && current) {
      current.bullets.push(h.text);
    }
  }
  return sections.slice(0, 5).map((s) => ({ title: s.title, bullets: s.bullets.slice(0, 5) }));
}

// No intent mapping; we will strictly derive from SERP content
function inferIntent(keywords) {
  return 'content_based';
}

// Build sections from frequent headings across sources
function buildSectionsFromHeadings(headings) {
  const freq = new Map();
  headings.forEach((h) => {
    const t = h.text.trim();
    if (t.length < 3 || t.length > 100) return;
    const key = t.toLowerCase();
    freq.set(key, (freq.get(key) || 0) + (h.tag === 'h2' ? 3 : h.tag === 'h3' ? 2 : 1));
  });
  const ranked = Array.from(freq.entries()).sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const titles = uniq(ranked.map((k) => k.replace(/\s+/g, ' ').trim())).slice(0, 5);
  return titles.map((t) => ({ title: t.charAt(0).toUpperCase() + t.slice(1), bullets: [] }));
}

function generateOutlineAndIdea(clusterLabel, clusterKeywords, extracted) {
  const mergedHeadings = [];
  for (const page of extracted) mergedHeadings.push(...page.headings);
  let sections = pickSections(mergedHeadings);
  if (!sections || sections.length === 0) sections = buildSectionsFromHeadings(mergedHeadings);
  const intro = `Overview of ${clusterLabel}. Based on top-ranked sources: ${extracted.slice(0, 3).map(e => e.title).join('; ')}.`;
  const conclusion = `Key takeaways compiled from the sources above.`;
  const outline = {
    title: `${clusterLabel} – Outline`,
    intro,
    sections,
    conclusion,
    sources: extracted.map((e) => ({ title: e.title, url: e.url, meta: e.meta || '' })).slice(0, 5),
  };
  const idea = `Create a concise explainer on ${clusterLabel} that mirrors common headings across top results, highlighting what users care about most.`;
  // Ad-focused copy (Google Search style): strictly from content
  const ad = generateAdCopy(clusterLabel, clusterKeywords, mergedHeadings, extracted, 'content_based');
  return { outline, idea, ad };
}
function uniq(arr) {
  return Array.from(new Set(arr.filter(Boolean)));
}

function truncate(s, n) {
  if (!s) return s;
  return s.length <= n ? s : s.slice(0, n - 1).trimEnd() + '…';
}

// --- Helpers for ad generation from SERP content ---
const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'for', 'to', 'in', 'on', 'with', 'by', 'from', 'at', 'how', 'what', 'why', 'vs', '&', 'you', 'your']);
function tokensFrom(text) {
  return (text || '').toLowerCase().match(/[a-z0-9]+/g) || [];
}
function titleCase(s) {
  return s.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1));
}
function splitTitle(t) {
  if (!t) return '';
  const parts = t.split(/\s[\-|–—|:·•]\s|\s-\s|\s\|\s/g);
  return (parts[0] || t).trim();
}
function cleanSerpTitle(title, url) {
  const base = splitTitle(title);
  try {
    const host = new URL(url).hostname.replace(/^www\./, '').split('.')[0];
    return base.replace(new RegExp(host, 'i'), '').trim() || base;
  } catch { return base; }
}
function ngrams(words, n) {
  const out = [];
  for (let i = 0; i <= words.length - n; i++) out.push(words.slice(i, i + n).join(' '));
  return out;
}
function scorePhrasesFromSources(pages, headings, keywords) {
  const counts = new Map();
  const bump = (p, w = 1) => counts.set(p, (counts.get(p) || 0) + w);
  const addText = (t, weight) => {
    const words = tokensFrom(t).filter((x) => x.length > 2 && !STOP.has(x));
    ngrams(words, 3).forEach((p) => bump(p, 3 * weight));
    ngrams(words, 2).forEach((p) => bump(p, 2 * weight));
    ngrams(words, 1).forEach((p) => bump(p, 1 * weight));
  };
  pages.forEach((p) => { addText(cleanSerpTitle(p.title, p.url), 4); addText(p.meta, 3); addText(p.snippet || '', 2); });
  headings.forEach((h) => addText(h.text, 2));
  keywords.forEach((k) => addText(k, 2));
  const ranked = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).map(([p]) => p);
  return ranked;
}

function selectTopResults(results, intent) {
  const badDomains = new Set([
    'youtube.com', 'm.youtube.com', 'apps.apple.com', 'play.google.com', 'cnn.com', 'bbc.com', 'twitter.com', 'facebook.com', 'instagram.com'
  ]);
  const isBad = (u) => {
    try { const d = new URL(u).hostname.replace(/^www\./, ''); return badDomains.has(d); } catch { return true; }
  };
  const prefers = intent === 'transactional'
    ? /(order|menu|coupon|deal|delivery|near|price|store|offer)/i
    : /(guide|how|learn|tutorial|tips|best|ideas)/i;
  const scored = results.map((r) => {
    const t = `${r.title} ${r.snippet || ''}`;
    const pref = prefers.test(t) ? 1 : 0;
    return { r, score: pref - (isBad(r.url) ? 2 : 0) };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.filter(s => s.score > -2).map(s => s.r).slice(0, 5);
}

function canonicalSections(intent) {
  if (intent === 'transactional') {
    return [
      { key: 'order', title: 'Order Online' },
      { key: 'menu', title: 'Menu & Prices' },
      { key: 'deals', title: 'Deals & Coupons' },
      { key: 'delivery', title: 'Delivery & Tracking' },
      { key: 'locations', title: 'Locations & Hours' },
      { key: 'faq', title: 'FAQs' },
    ];
  }
  return [
    { key: 'overview', title: 'Overview' },
    { key: 'steps', title: 'Step-by-step' },
    { key: 'tips', title: 'Tips & Best Practices' },
    { key: 'tools', title: 'Tools & Resources' },
    { key: 'faq', title: 'FAQs' },
  ];
}

function buildSectionsFromPhrases(intent, phrases) {
  const sections = [];
  const canon = canonicalSections(intent);
  const text = phrases.join(' ').toLowerCase();
  for (const c of canon) {
    let hit = false;
    if (intent === 'transactional') {
      if (c.key === 'order') hit = /order|online|buy/.test(text);
      if (c.key === 'menu') hit = hit || /menu|price|sizes|toppings/.test(text);
      if (c.key === 'deals') hit = hit || /deal|coupon|offer|discount/.test(text);
      if (c.key === 'delivery') hit = hit || /delivery|track|time|fee/.test(text);
      if (c.key === 'locations') hit = hit || /near|store|location|hours/.test(text);
    } else {
      if (c.key === 'overview') hit = /what|overview|about/.test(text);
      if (c.key === 'steps') hit = hit || /how|step|guide/.test(text);
      if (c.key === 'tips') hit = hit || /tips|best|mistakes/.test(text);
      if (c.key === 'tools') hit = hit || /tools|resources|platforms/.test(text);
    }
    if (hit) sections.push({ title: c.title, bullets: [] });
    if (sections.length >= 5) break;
  }
  // Ensure at least 4 sections
  while (sections.length < 4 && sections.length < canon.length) {
    const next = canon[sections.length];
    sections.push({ title: next.title, bullets: [] });
  }
  return sections.slice(0, 5);
}

function generateAdCopy(label, keywords, headings, pages, intent) {
  // Build candidate phrases from SERP titles/snippets/headings
  const ranked = scorePhrasesFromSources(pages, headings, keywords);
  // Prefer cleaned SERP titles first, then ranked phrases
  const cleanedTitles = uniq(pages.map((p) => cleanSerpTitle(p.title, p.url)).filter(Boolean));
  let headlines = cleanedTitles.concat(ranked)
    .map((p) => titleCase(p))
    .filter((h) => h.length >= 8)
    .map((h) => truncate(h, 30));
  // Ensure we include the label once if missing
  if (!headlines.length) headlines = [truncate(titleCase(label), 30)];
  headlines = uniq(headlines).slice(0, 6);

  // Descriptions: keep full for display; also prepare 90-char variants for RSA
  const fullMetas = pages.map((p) => p.meta || p.snippet || '').filter(Boolean);
  let descriptionsFull = fullMetas.length ? fullMetas : [`Overview and key points for ${label}.`];
  descriptionsFull = uniq(descriptionsFull).slice(0, 4);
  const descriptions90 = descriptionsFull.map((d) => truncate(d, 90)).slice(0, 4);

  // CTAs by intent
  const ctas = intent === 'transactional'
    ? ['Shop Now', 'Get Quote']
    : intent === 'informational'
      ? ['Learn More', 'Start Now']
      : ['Compare Now', 'See Options'];

  // Google Search Ad (RSA) suggestion
  function toPathFragment(text) {
    const t = (text || '').toLowerCase().replace(/[^a-z0-9\-\s]/g, '').trim().replace(/\s+/g, '-');
    return t.slice(0, 15);
  }
  const topKw = (keywords[0] || label).split(' ')[0] || label;
  const secondKw = (keywords[1] || '').split(' ')[0] || '';
  const rsa = {
    headlines: headlines.slice(0, 3),
    descriptions: descriptions90.slice(0, 2),
    path1: toPathFragment(topKw),
    path2: toPathFragment(secondKw),
    finalUrl: (pages[0] && pages[0].url) || ''
  };

  return { headlines, descriptions: descriptionsFull, ctas, rsa };
}


