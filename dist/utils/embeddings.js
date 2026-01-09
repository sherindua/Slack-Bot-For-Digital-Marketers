"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.embedStrings = embedStrings;

let modelPromise = null;
async function getModel() {
  if (!modelPromise) {
    const mod = await import("@xenova/transformers");
    const { pipeline } = mod;
    modelPromise = pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  }
  return modelPromise;
}

// Returns Float32Array[] of shape [n, 384]
async function embedStrings(texts) {
  const extractor = await getModel();
  const input = Array.isArray(texts) ? texts : [texts];
  const output = await extractor(input, { normalize: true, pooling: 'mean' });
  const list = output.tolist();
  const rows = Array.isArray(list[0]) ? list : [list];
  return rows.map((row) => Float32Array.from(row));
}


