"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderReportPdf = renderReportPdf;
const puppeteer = require("puppeteer");

function htmlEscape(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildHtml(payload) {
  const { title, user, createdAt, keywords, clusters, outlines } = payload;
  const kwList = keywords.map((k) => `<li>${htmlEscape(k)}</li>`).join('');
  const clusterHtml = clusters.map((c, i) => {
    const items = c.keywords.map((k) => `<li>${htmlEscape(k)}</li>`).join('');
    return `<div class="cluster"><h3>Cluster ${i + 1}: ${htmlEscape(c.label)}</h3><ul>${items}</ul></div>`;
  }).join('');
  const outlineHtml = outlines.map((o) => {
    const sections = o.outline.sections.map((s) => `<h4>${htmlEscape(s.title)}</h4>${s.bullets.length ? `<ul>${s.bullets.map((b) => `<li>${htmlEscape(b)}</li>`).join('')}</ul>` : ''}`).join('');
    const ads = `<p><strong>Ad Headlines:</strong> ${o.ad.headlines.map(htmlEscape).join(' | ')}</p><p><strong>Descriptions:</strong> ${o.ad.descriptions.map(htmlEscape).join(' | ')}</p>`;
    const sources = o.outline.sources.map((s) => `<li><a href="${s.url}">${htmlEscape(s.title || s.url)}</a></li>`).join('');
    return `<div class="outline"><h3>${htmlEscape(o.label)}</h3>${sections}${ads}<h4>Sources</h4><ul>${sources}</ul></div>`;
  }).join('');
  return `<!doctype html><html><head><meta charset="utf-8"/><title>${htmlEscape(title)}</title>
  <style>body{font-family:Arial,Helvetica,sans-serif;color:#111;padding:24px;}h1{margin:0 0 8px;}h2{margin:24px 0 8px;}h3{margin:16px 0 6px;}h4{margin:12px 0 4px;}ul{margin:6px 0 12px 18px;} .cluster,.outline{margin-bottom:16px;padding-bottom:8px;border-bottom:1px solid #eee;}</style></head>
  <body>
  <h1>${htmlEscape(title)}</h1>
  <p><strong>User:</strong> ${htmlEscape(user)} &nbsp; | &nbsp; <strong>Date:</strong> ${htmlEscape(createdAt)}</p>
  <h2>Cleaned Keywords</h2><ul>${kwList}</ul>
  <h2>Clusters</h2>${clusterHtml}
  <h2>Outlines & Ads</h2>${outlineHtml}
  </body></html>`;
}

async function renderReportPdf(reportPayload) {
  const html = buildHtml(reportPayload);
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '16mm', right: '12mm', bottom: '16mm', left: '12mm' } });
    return pdf; // Buffer
  } finally {
    await browser.close();
  }
}


