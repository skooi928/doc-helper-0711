import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface DocState {
  [sourceRel: string]: {
    documented: boolean;
    timestamp: string;
  };
}

interface VSCodeSettings {
  'doc-helper-0711.docsDirectory'?: string;
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

function getUserSettingsPath(): string {
  const platform = os.platform();
  const homeDir = os.homedir();
  
  switch (platform) {
    case 'win32':
      return path.join(homeDir, 'AppData', 'Roaming', 'Code', 'User', 'settings.json');
    case 'darwin':
      return path.join(homeDir, 'Library', 'Application Support', 'Code', 'User', 'settings.json');
    default:
      return path.join(homeDir, 'AppData', 'Roaming', 'Code', 'User', 'settings.json');
  }
}

async function getDocsDirectoryFromVSCode(root: string): Promise<string> {
  const defaultDocsDir = 'docs/';
  
  try {
    // Try workspace settings first
    const workspaceSettingsPath = path.join(root, '.vscode', 'settings.json');
    
    for (const settingsPath of [workspaceSettingsPath, getUserSettingsPath()]) {
      try {
        const content = await fs.readFile(settingsPath, 'utf8');
        // Remove JSON comments (VS Code allows them)
        const cleanContent = content.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
        const settings = JSON.parse(cleanContent);
        
        const docsDir = settings['doc-helper-0711.docsDirectory'];
        if (docsDir) {
          return docsDir;
        }
      } catch {
        // Continue to next settings file
      }
    }
    
    return defaultDocsDir;
  } catch {
    return defaultDocsDir;
  }
}

export async function driftNode(files: string[], root: string) {
  const state = await loadDocState(root);

  const docsDirectory = await getDocsDirectoryFromVSCode(root);

  for (const rel of files) {
    const docRel = rel.replace(/^src[\/\\]/, docsDirectory).replace(/\.(ts|js|tsx)$/, '.md');
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

  const docsDirectory = await getDocsDirectoryFromVSCode(root);
  
  for (const docRel of files) {
    const srcRel = docRel.replace(new RegExp('^' + docsDirectory.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'src/').replace(/\.md$/, '.ts');
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