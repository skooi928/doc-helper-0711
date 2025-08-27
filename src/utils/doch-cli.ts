import { promises as fs } from 'fs';
import * as path from 'path';

export interface DocState {
  [sourceRel: string]: {
    documented: boolean;
    timestamp: string;
  };
}

async function ensureMetaDir(root: string) {
  const metaDir = path.join(root, '.doch', 'metadata');
  await fs.mkdir(metaDir, { recursive: true });
  return path.join(metaDir, 'doc-state.json');
}

async function loadDocState(root: string): Promise<DocState> {
  const filePath = await ensureMetaDir(root);
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    // initialize empty
    const init: DocState = {};
    await fs.writeFile(filePath, JSON.stringify(init, null, 2), 'utf8');
    return init;
  }
}

async function saveDocState(root: string, state: DocState) {
  const filePath = await ensureMetaDir(root);
  await fs.writeFile(filePath, JSON.stringify(state, null, 2), 'utf8');
}

export async function driftNode(files: string[], root: string) {
  const state = await loadDocState(root);
  for (const rel of files) {
    const docRel = rel.replace(/^src[\/\\]/, 'docs/').replace(/\.(ts|js|tsx)$/, '.md');
    const fullDoc = path.join(root, docRel);
    let documented = true;
    try {
      await fs.stat(fullDoc);
    } catch {
      documented = false;
    }
    state[rel] = { documented, timestamp: new Date().toISOString() };
  }
  await saveDocState(root, state);
  console.log(`Drift: updated ${files.length} entries`);
}

export async function checkNode(files: string[], root: string) {
  const state = await loadDocState(root);
  for (const docRel of files) {
    const srcRel = docRel.replace(/^docs[\/\\]/, 'src/').replace(/\.md$/, '.ts');
    const fullSrc = path.join(root, srcRel);
    let documented = true;
    try {
      await fs.stat(fullSrc);
    } catch {
      documented = false;
    }
    state[srcRel] = { documented, timestamp: new Date().toISOString() };
  }
  await saveDocState(root, state);
  console.log(`Check: updated ${files.length} entries`);
}