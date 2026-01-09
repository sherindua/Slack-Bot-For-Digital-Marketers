"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const bolt_1 = require("@slack/bolt");
const keywords_1 = require("./utils/keywords");
const supabase_1 = require("./utils/supabase");
const embeddings_1 = require("./utils/embeddings");
const vectorCluster_1 = require("./utils/vectorCluster");
const outline_1 = require("./utils/outline");
const report_1 = require("./utils/report");
// Basic Socket Mode Slack app
const app = new bolt_1.App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
  logLevel: process.env.SLACK_LOG_LEVEL || bolt_1.LogLevel.INFO,
});
// Handle CSV file uploads shared in channels
app.event('file_shared', async ({ event, client }) => {
  try {
    const fileId = event.file_id;
    const channelId = event.channel_id;
    if (!fileId || !channelId) return;
    const info = await client.files.info({ file: fileId });
    const file = info.file;
    if (!file) return;
    const isCsv = (file.mimetype && file.mimetype.includes('csv')) || (file.name && file.name.toLowerCase().endsWith('.csv'));
    if (!isCsv || !file.url_private_download) {
      await client.chat.postMessage({ channel: channelId, text: 'Please upload a CSV file.' });
      return;
    }
    const res = await fetch(file.url_private_download, {
      headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
    });
    const csvText = await res.text();
    // Reuse keyword cleaner on raw CSV text
    const cleaned = (0, keywords_1.parseAndCleanKeywords)(csvText);
    if (cleaned.length === 0) {
      await client.chat.postMessage({ channel: channelId, text: 'No keywords found in CSV.' });
      return;
    }
    const formatted = (0, keywords_1.formatListAsNumbered)(cleaned);
    // If Supabase env exists, embed and insert
    try {
      const batchId = await (0, supabase_1.createBatch)(info.file && info.file.user || 'unknown', channelId);
      if (batchId) {
        const vectors = await (0, embeddings_1.embedStrings)(cleaned);
        const rows = cleaned.map((k, i) => ({ cleaned: k, embedding: Array.from(vectors[i]) }));
        await (0, supabase_1.insertKeywords)(batchId, rows);
        const clusters = (0, vectorCluster_1.clusterFromVectors)(cleaned, vectors, { threshold: 0.75 });
        const blocksClusters = (0, vectorCluster_1.formatClustersAsBlocks)(clusters, { maxClustersToShow: 5, maxItemsPerCluster: 10 });
        await client.chat.postMessage({
          channel: channelId,
          text: 'Clusters',
          blocks: [
            { type: 'section', text: { type: 'mrkdwn', text: '*Clusters (semantic)*' } },
            ...blocksClusters,
          ],
        });
        // Generate outlines and one idea for top clusters (limit to 2)
        const topClusters = clusters.slice(0, 2);
        const outlineBlocks = [];
        for (const c of topClusters) {
          const q = c.keywords[0] || c.label;
          const results = await (0, outline_1.searchTopResults)(q, 3);
          const extracted = [];
          for (const r of results) {
            const page = await (0, outline_1.extractHeadings)(r.url);
            extracted.push({ url: r.url, title: page.title, meta: page.meta, headings: page.headings });
          }
          const { outline, idea, ad } = (0, outline_1.generateOutlineAndIdea)(c.label, c.keywords, extracted);
          const bullets = outline.sections.map((s) => `• ${s.title}${s.bullets.length ? `\n   - ` + s.bullets.join(`\n   - `) : ''}`).join(`\n`);
          outlineBlocks.push({ type: 'divider' });
          outlineBlocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*Outline: ${outline.title}*` } });
          outlineBlocks.push({ type: 'section', text: { type: 'mrkdwn', text: '```' + bullets.slice(0, 2800) + '```' } });
          outlineBlocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*Post Idea*: ${idea}` } });
          outlineBlocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*Ad Headlines*\n• ${ad.headlines.join('\n• ')}` } });
          outlineBlocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*Ad Descriptions (full)*\n• ${ad.descriptions.join('\n• ')}` } });
          outlineBlocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `CTAs: ${ad.ctas.join(' | ')}` }] });
          outlineBlocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*Google RSA Suggestion*\nHeadlines: ${ad.rsa.headlines.join(' | ')}\nDescriptions: ${ad.rsa.descriptions.join(' | ')}\nPaths: ${ad.rsa.path1}/${ad.rsa.path2}` } });
          if ((process.env.SERP_DEBUG || '') === '1') {
            outlineBlocks.push({ type: 'divider' });
            outlineBlocks.push({ type: 'section', text: { type: 'mrkdwn', text: '*Sources (SERP)*' } });
            for (const r of results) {
              const snip = (r.snippet || '').slice(0, 180);
              outlineBlocks.push({ type: 'section', text: { type: 'mrkdwn', text: `• <${r.url}|${r.title}>\n>${snip}` } });
            }
            outlineBlocks.push({ type: 'section', text: { type: 'mrkdwn', text: '*Extracted Headings*' } });
            for (const p of extracted.slice(0, 2)) {
              const hs = p.headings.slice(0, 5).map((h) => `- ${h.text}`).join('\n');
              outlineBlocks.push({ type: 'section', text: { type: 'mrkdwn', text: `_${p.title}_\n` + '```' + hs + '```' } });
            }
          }
        }
        if (outlineBlocks.length) {
          await client.chat.postMessage({ channel: channelId, text: 'Outlines', blocks: outlineBlocks });
        }
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('Supabase insert failed (CSV path)', e);
    }
    await client.chat.postMessage({
      channel: channelId,
      text: 'Processed keywords from CSV',
      blocks: [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: '*Cleaned Keywords (from CSV)*\n' + '```' + formatted + '```' },
        },
      ],
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('file_shared handling failed', err);
  }
});
// Slash command: /keywords
app.command('/keywords', async ({ ack, respond, command }) => {
  await ack();
  const userText = (command === null || command === void 0 ? void 0 : command.text) || '';
  const cleaned = (0, keywords_1.parseAndCleanKeywords)(userText);
  if (cleaned.length === 0) {
    await respond({
      response_type: 'ephemeral',
      text: 'Paste a list of keywords separated by commas or newlines after the command.',
    });
    return;
  }
  const formatted = (0, keywords_1.formatListAsNumbered)(cleaned);
  // Embed + insert if configured
  try {
    const batchId = await (0, supabase_1.createBatch)(command.user_id || 'unknown', command.channel_id || 'unknown');
    if (batchId) {
      const vectors = await (0, embeddings_1.embedStrings)(cleaned);
      const rows = cleaned.map((k, i) => ({ cleaned: k, embedding: Array.from(vectors[i]) }));
      await (0, supabase_1.insertKeywords)(batchId, rows);
      const clusters = (0, vectorCluster_1.clusterFromVectors)(cleaned, vectors, { threshold: 0.75 });
      const blocksClusters = (0, vectorCluster_1.formatClustersAsBlocks)(clusters, { maxClustersToShow: 5, maxItemsPerCluster: 10 });
      await respond({ response_type: 'ephemeral', text: 'Clusters', blocks: [{ type: 'section', text: { type: 'mrkdwn', text: '*Clusters (semantic)*' } }, ...blocksClusters] });
      // Add outlines and one idea per top cluster
      const topClusters = clusters.slice(0, 2);
      const outlineBlocks = [];
      for (const c of topClusters) {
        const q = c.keywords[0] || c.label;
        const results = await (0, outline_1.searchTopResults)(q, 3);
        const extracted = [];
        for (const r of results) {
          const page = await (0, outline_1.extractHeadings)(r.url);
          extracted.push({ url: r.url, title: page.title, meta: page.meta, headings: page.headings });
        }
        const { outline, idea, ad } = (0, outline_1.generateOutlineAndIdea)(c.label, c.keywords, extracted);
        const bullets = outline.sections.map((s) => `• ${s.title}${s.bullets.length ? `\n   - ` + s.bullets.join(`\n   - `) : ''}`).join(`\n`);
        outlineBlocks.push({ type: 'divider' });
        outlineBlocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*Outline: ${outline.title}*` } });
        outlineBlocks.push({ type: 'section', text: { type: 'mrkdwn', text: '```' + bullets.slice(0, 2800) + '```' } });
        outlineBlocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*Post Idea*: ${idea}` } });
        outlineBlocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*Ad Headlines*\n• ${ad.headlines.join('\n• ')}` } });
        outlineBlocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*Ad Descriptions (full)*\n• ${ad.descriptions.join('\n• ')}` } });
        outlineBlocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `CTAs: ${ad.ctas.join(' | ')}` }] });
        outlineBlocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*Google RSA Suggestion*\nHeadlines: ${ad.rsa.headlines.join(' | ')}\nDescriptions: ${ad.rsa.descriptions.join(' | ')}\nPaths: ${ad.rsa.path1}/${ad.rsa.path2}` } });
        if ((process.env.SERP_DEBUG || '') === '1') {
          outlineBlocks.push({ type: 'divider' });
          outlineBlocks.push({ type: 'section', text: { type: 'mrkdwn', text: '*Sources (SERP)*' } });
          for (const r of results) {
            const snip = (r.snippet || '').slice(0, 180);
            outlineBlocks.push({ type: 'section', text: { type: 'mrkdwn', text: `• <${r.url}|${r.title}>\n>${snip}` } });
          }
          outlineBlocks.push({ type: 'section', text: { type: 'mrkdwn', text: '*Extracted Headings*' } });
          for (const p of extracted.slice(0, 2)) {
            const hs = p.headings.slice(0, 5).map((h) => `- ${h.text}`).join('\n');
            outlineBlocks.push({ type: 'section', text: { type: 'mrkdwn', text: `_${p.title}_\n` + '```' + hs + '```' } });
          }
        }
      }
      if (outlineBlocks.length) {
        await respond({ response_type: 'ephemeral', text: 'Outlines', blocks: outlineBlocks });
      }
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('Supabase insert failed (/keywords)', e);
  }
  await respond({
    response_type: 'ephemeral',
    text: 'Processed keywords',
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*Cleaned Keywords*\n' + '```' + formatted + '```',
        },
      },
    ],
  });
});
// Alias: /keyword (singular)
app.command('/keyword', async ({ ack, respond, command }) => {
  await ack();
  const userText = (command === null || command === void 0 ? void 0 : command.text) || '';
  const cleaned = (0, keywords_1.parseAndCleanKeywords)(userText);
  if (cleaned.length === 0) {
    await respond({
      response_type: 'ephemeral',
      text: 'Paste a list of keywords separated by commas or newlines after the command.',
    });
    return;
  }
  const formatted = (0, keywords_1.formatListAsNumbered)(cleaned);
  try {
    const batchId = await (0, supabase_1.createBatch)(command.user_id || 'unknown', command.channel_id || 'unknown');
    if (batchId) {
      const vectors = await (0, embeddings_1.embedStrings)(cleaned);
      const rows = cleaned.map((k, i) => ({ cleaned: k, embedding: Array.from(vectors[i]) }));
      await (0, supabase_1.insertKeywords)(batchId, rows);
      const clusters = (0, vectorCluster_1.clusterFromVectors)(cleaned, vectors, { threshold: 0.75 });
      const blocksClusters = (0, vectorCluster_1.formatClustersAsBlocks)(clusters, { maxClustersToShow: 5, maxItemsPerCluster: 10 });
      await respond({ response_type: 'ephemeral', text: 'Clusters', blocks: [{ type: 'section', text: { type: 'mrkdwn', text: '*Clusters (semantic)*' } }, ...blocksClusters] });
      const topClusters = clusters.slice(0, 2);
      const outlineBlocks = [];
      for (const c of topClusters) {
        const q = c.keywords[0] || c.label;
        const results = await (0, outline_1.searchTopResults)(q, 3);
        const extracted = [];
        for (const r of results) {
          const page = await (0, outline_1.extractHeadings)(r.url);
          extracted.push({ url: r.url, title: page.title, meta: page.meta, headings: page.headings });
        }
        const { outline, idea, ad } = (0, outline_1.generateOutlineAndIdea)(c.label, c.keywords, extracted);
        const bullets = outline.sections.map((s) => `• ${s.title}${s.bullets.length ? `\n   - ` + s.bullets.join(`\n   - `) : ''}`).join(`\n`);
        outlineBlocks.push({ type: 'divider' });
        outlineBlocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*Outline: ${outline.title}*` } });
        outlineBlocks.push({ type: 'section', text: { type: 'mrkdwn', text: '```' + bullets.slice(0, 2800) + '```' } });
        outlineBlocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*Post Idea*: ${idea}` } });
        outlineBlocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*Ad Headlines*\n• ${ad.headlines.join('\n• ')}` } });
        outlineBlocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*Ad Descriptions (full)*\n• ${ad.descriptions.join('\n• ')}` } });
        outlineBlocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `CTAs: ${ad.ctas.join(' | ')}` }] });
        outlineBlocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*Google RSA Suggestion*\nHeadlines: ${ad.rsa.headlines.join(' | ')}\nDescriptions: ${ad.rsa.descriptions.join(' | ')}\nPaths: ${ad.rsa.path1}/${ad.rsa.path2}` } });
        if ((process.env.SERP_DEBUG || '') === '1') {
          outlineBlocks.push({ type: 'divider' });
          outlineBlocks.push({ type: 'section', text: { type: 'mrkdwn', text: '*Sources (SERP)*' } });
          for (const r of results) {
            const snip = (r.snippet || '').slice(0, 180);
            outlineBlocks.push({ type: 'section', text: { type: 'mrkdwn', text: `• <${r.url}|${r.title}>\n>${snip}` } });
          }
          outlineBlocks.push({ type: 'section', text: { type: 'mrkdwn', text: '*Extracted Headings*' } });
          for (const p of extracted.slice(0, 2)) {
            const hs = p.headings.slice(0, 5).map((h) => `- ${h.text}`).join('\n');
            outlineBlocks.push({ type: 'section', text: { type: 'mrkdwn', text: `_${p.title}_\n` + '```' + hs + '```' } });
          }
        }
      }
      if (outlineBlocks.length) {
        await respond({ response_type: 'ephemeral', text: 'Outlines', blocks: outlineBlocks });
      }
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('Supabase insert failed (/keyword)', e);
  }
  await respond({
    response_type: 'ephemeral',
    text: 'Processed keywords',
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*Cleaned Keywords*\n' + '```' + formatted + '```',
        },
      },
    ],
  });
});
app.event('app_mention', async ({ event, say }) => {
  const userText = event.text || '';
  const cleaned = (0, keywords_1.parseAndCleanKeywords)(userText);
  if (cleaned.length === 0) {
    await say(':wave: Paste a list of keywords separated by commas/newlines after mentioning me.');
    return;
  }
  const formatted = (0, keywords_1.formatListAsNumbered)(cleaned);
  await say({
    text: 'Processed keywords',
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*Cleaned Keywords*\n' + '```' + formatted + '```',
        },
      },
    ],
  });
});

// Slash command: /report <batch_id> — generate a PDF and upload to Slack
app.command('/report', async ({ ack, respond, command, client }) => {
  await ack();
  try {
    const args = (command.text || '').trim().split(/\s+/).filter(Boolean);
    if (args.length < 1) {
      await respond({ response_type: 'ephemeral', text: 'Usage: /report <batch_id>' });
      return;
    }
    const batchId = args[0];
    const keywords = await (0, supabase_1.fetchAllKeywords)(batchId);
    if (!keywords || keywords.length === 0) {
      await respond({ response_type: 'ephemeral', text: 'No keywords found for that batch.' });
      return;
    }
    // Generate embeddings and clusters for the saved keywords
    const vectors = await (0, embeddings_1.embedStrings)(keywords);
    const clusters = (0, vectorCluster_1.clusterFromVectors)(keywords, vectors, { threshold: 0.75 });
    // Build outlines/ads for top clusters (cap to 3 to keep report concise)
    const outlines = [];
    for (const c of clusters.slice(0, 3)) {
      const q = c.keywords[0] || c.label;
      const results = await (0, outline_1.searchTopResults)(q, 3);
      const extracted = [];
      for (const r of results) {
        const page = await (0, outline_1.extractHeadings)(r.url);
        extracted.push({ url: r.url, title: page.title, meta: page.meta, headings: page.headings, snippet: r.snippet });
      }
      const { outline, ad } = (0, outline_1.generateOutlineAndIdea)(c.label, c.keywords, extracted);
      outlines.push({ label: c.label, outline, ad });
    }
    const payload = {
      title: 'Keyword Processing Report',
      user: command.user_name || command.user_id,
      createdAt: new Date().toLocaleString(),
      keywords,
      clusters,
      outlines,
    };
    const pdfBuffer = await (0, report_1.renderReportPdf)(payload);
    // Upload to Slack
    await client.files.upload({ channels: command.channel_id, filename: `report-${batchId}.pdf`, file: pdfBuffer, filetype: 'pdf', title: `Report for ${batchId}` });
    await respond({ response_type: 'ephemeral', text: 'Report generated and uploaded.' });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('report failed', e);
    await respond({ response_type: 'ephemeral', text: 'Failed to generate report. Check logs and env.' });
  }
});

// Slash command: /history — list recent batches for the user
app.command('/history', async ({ ack, respond, command }) => {
  await ack();
  try {
    const slackUserId = command.user_id || 'unknown';
    const batches = await (0, supabase_1.listRecentBatches)(slackUserId, 10);
    if (!batches || batches.length === 0) {
      await respond({ response_type: 'ephemeral', text: 'No history found.' });
      return;
    }
    const lines = [];
    for (const b of batches) {
      const kwCount = await (0, supabase_1.countKeywords)(b.id);
      const preview = await (0, supabase_1.fetchKeywordsPreview)(b.id, 3);
      const when = new Date(b.created_at).toLocaleString();
      const subtitle = preview.length ? `“${preview.join(', ')}${kwCount > preview.length ? ', …' : ''}”` : '';
      lines.push(`• *${when}* — ${kwCount} keywords ${subtitle}\n   Batch: ${b.id}`);
    }
    await respond({
      response_type: 'ephemeral',
      text: 'Recent batches',
      blocks: [
        { type: 'section', text: { type: 'mrkdwn', text: '*Recent Batches*' } },
        { type: 'section', text: { type: 'mrkdwn', text: lines.join('\n\n') } },
        { type: 'context', elements: [{ type: 'mrkdwn', text: 'Use `/reprocess <batch_id>` to regenerate outlines/ads for a specific run.' }] },
      ],
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('history failed', e);
    await respond({ response_type: 'ephemeral', text: 'Failed to fetch history. Please try again.' });
  }
});
async function start() {
  const port = Number(process.env.PORT || 3000);
  await app.start(port);
  // eslint-disable-next-line no-console
  console.log(`⚡️ Slack bot is running in Socket Mode on port ${port}`);
}
start().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Failed to start Slack app', err);
  process.exit(1);
});
