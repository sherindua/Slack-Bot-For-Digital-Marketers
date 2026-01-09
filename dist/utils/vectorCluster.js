"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.clusterFromVectors = clusterFromVectors;
exports.formatClustersAsBlocks = formatClustersAsBlocks;

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    const av = a[i];
    const bv = b[i];
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function tokenize(text) {
  const m = (text || "").toLowerCase().match(/[a-z0-9]+/g);
  return m ? m : [];
}

function labelForCluster(keywords) {
  const counts = new Map();
  for (const k of keywords) {
    for (const t of tokenize(k)) counts.set(t, (counts.get(t) || 0) + 1);
  }
  const ranked = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  return ranked.slice(0, 2).map(([t]) => t).join(" ") || "misc";
}

// keywords: string[], vectors: Float32Array[] (same length)
// returns: Array<{ label: string, keywords: string[] }>
function clusterFromVectors(keywords, vectors, options) {
  const n = keywords.length;
  const threshold = (options && options.threshold) || 0.75; // cosine similarity
  if (n === 0) return [];
  // Build adjacency matrix sparsely using threshold
  const adj = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const sim = cosine(vectors[i], vectors[j]);
      if (sim >= threshold) {
        adj[i].push(j);
        adj[j].push(i);
      }
    }
  }
  // Connected components
  const visited = new Array(n).fill(false);
  const clusters = [];
  for (let i = 0; i < n; i++) {
    if (visited[i]) continue;
    const queue = [i];
    visited[i] = true;
    const members = [i];
    while (queue.length) {
      const u = queue.shift();
      const neighbors = adj[u];
      for (let v of neighbors) {
        if (!visited[v]) {
          visited[v] = true;
          queue.push(v);
          members.push(v);
        }
      }
    }
    const groupKeywords = members.map((idx) => keywords[idx]);
    clusters.push({ label: labelForCluster(groupKeywords), keywords: groupKeywords });
  }
  // Sort by size desc
  clusters.sort((a, b) => b.keywords.length - a.keywords.length);
  return clusters;
}

function formatClustersAsBlocks(clusters, options) {
  const limitClusters = (options && options.maxClustersToShow) || 8;
  const limitItems = (options && options.maxItemsPerCluster) || 20;
  const blocks = [];
  const shown = clusters.slice(0, limitClusters);
  shown.forEach((c, i) => {
    const items = c.keywords.slice(0, limitItems).map((k, idx) => `${idx + 1}. ${k}`).join("\n");
    const more = c.keywords.length > limitItems ? `\n… and ${c.keywords.length - limitItems} more` : "";
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*Cluster ${i + 1}: ${c.label}*\n\`\`\`${items}${more}\`\`\`` } });
    if (i !== shown.length - 1) blocks.push({ type: 'divider' });
  });
  return blocks;
}


