import fs from 'node:fs';
import path from 'node:path';
import fetch from 'node-fetch';

const API_KEY = process.env.POSTMAN_API_KEY;
const WORKSPACE_ID = process.env.POSTMAN_WORKSPACE_ID;
const RETAIN_LAST_N = Number(process.env.RETAIN_LAST_N || '5');

if (!API_KEY || !WORKSPACE_ID) {
  console.error('POSTMAN_API_KEY and POSTMAN_WORKSPACE_ID are required');
  process.exit(1);
}

const BASE_URL = 'https://api.getpostman.com';

function parseBuildMetadata(name, collection) {
  const match = name.match(/^(.*) \[build (.+)\]$/i);
  if (!match) return null;
  const base = match[1].trim();
  const buildRaw = match[2].trim();
  if (!base) return null;

  let score = null;
  let isNumeric = false;
  if (/^\d+$/.test(buildRaw)) {
    score = Number(buildRaw);
    isNumeric = true;
  } else {
    const ts = Date.parse(buildRaw);
    if (!Number.isNaN(ts)) {
      score = ts;
    } else if (collection?.updatedAt) {
      const updatedScore = Date.parse(collection.updatedAt);
      if (!Number.isNaN(updatedScore)) score = updatedScore;
    } else if (collection?.createdAt) {
      const createdScore = Date.parse(collection.createdAt);
      if (!Number.isNaN(createdScore)) score = createdScore;
    }
  }

  return {
    baseName: base,
    buildLabel: buildRaw,
    score,
    isNumeric,
  };
}

async function main() {
  console.log('Fetching collections for workspace', WORKSPACE_ID);
  const collections = await fetchCollections();
  const groups = new Map();

  for (const col of collections) {
    const meta = parseBuildMetadata(col?.name || '', col);
    if (!meta) continue;
    if (!groups.has(meta.baseName)) groups.set(meta.baseName, []);
    groups.get(meta.baseName).push({ ...col, meta });
  }

  if (groups.size === 0) {
    console.log('No versioned collections found. Nothing to clean.');
    return;
  }

  for (const [baseName, cols] of groups.entries()) {
    console.log(`\nProcessing base collection "${baseName}" (total ${cols.length})`);
    if (cols.length <= RETAIN_LAST_N) {
      console.log('  Below retention threshold, keeping all');
      continue;
    }

    const { keep, purge } = partitionCollections(cols, RETAIN_LAST_N);
    if (!purge.length) {
      console.log('  Ambiguous ordering or nothing to delete; keeping all');
      continue;
    }

    console.log(`  Keeping ${keep.length}, deleting ${purge.length}`);
    for (const kept of keep) {
      console.log(`    KEEP: ${kept.name} (${kept.uid})`);
    }
    for (const doomed of purge) {
      console.log(`    DELETE: ${doomed.name} (${doomed.uid})`);
      await deleteCollection(doomed.uid);
    }
  }
}

function partitionCollections(cols, retainCount) {
  const numeric = cols.every((c) => c.meta.isNumeric && Number.isFinite(c.meta.score));
  const sortable = cols.every((c) => Number.isFinite(c.meta.score));

  if (!sortable) {
    return { keep: cols, purge: [] };
  }

  const sorted = [...cols].sort((a, b) => {
    if (numeric) {
      return b.meta.score - a.meta.score;
    }
    return b.meta.score - a.meta.score;
  });

  const keep = sorted.slice(0, retainCount);
  const purge = sorted.slice(retainCount);
  return { keep, purge };
}

async function fetchCollections() {
  const url = new URL('/collections', BASE_URL);
  url.searchParams.set('workspace', WORKSPACE_ID);
  const res = await fetch(url, {
    headers: {
      'X-Api-Key': API_KEY,
    },
  });
  if (!res.ok) {
    throw new Error(`Failed to list collections: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  return data?.collections || [];
}

async function deleteCollection(uid) {
  if (!uid) return;
  const url = new URL(`/collections/${uid}`, BASE_URL);
  const res = await fetch(url, {
    method: 'DELETE',
    headers: {
      'X-Api-Key': API_KEY,
    },
  });
  if (!res.ok) {
    console.error(`      Failed to delete ${uid}: ${res.status} ${res.statusText}`);
  }
}

main().catch((err) => {
  console.error('Cleanup failed:', err);
  process.exit(1);
});
