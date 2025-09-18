import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';

export interface DocState {
  [sourceRel: string]: {
    documented: boolean;
    timestamp: string;
  };
}

interface VSCodeSettings {
  'doc-helper-0711.docsDirectory'?: string;
}

interface DochConfig {
  sourceDirectories?: string[];
  fileExtensions?: string[];
}

async function validateDochRepo(root: string): Promise<void> {
  const dochDir = path.join(root, '.doch');
  const configPath = path.join(dochDir, 'config.yml');
  const metadataDir = path.join(dochDir, 'metadata');

  try {
    // Check if .doch directory exists
    await fs.stat(dochDir);
  } catch {
    throw new Error(`DocHelper not initialized. Run "doch init" or initialize from VS Code extension first.\nMissing: ${dochDir}`);
  }

  try {
    // Check if config.yml exists
    await fs.stat(configPath);
  } catch {
    throw new Error(`DocHelper configuration missing. Expected config file at: ${configPath}\nRun "doch init" to create it.`);
  }

  try {
    // Check if metadata directory exists
    await fs.stat(metadataDir);
  } catch {
    // Create metadata directory if it doesn't exist (but .doch exists)
    await fs.mkdir(metadataDir, { recursive: true });
  }
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

async function readDochConfig(root: string): Promise<DochConfig> {
  const configPath = path.join(root, '.doch', 'config.yml');
  
  try {
    const configContent = await fs.readFile(configPath, 'utf8');
    const config = yaml.load(configContent) as DochConfig;
    
    return {
      sourceDirectories: Array.isArray(config.sourceDirectories) ? config.sourceDirectories : ["src/", "lib/", "app/"],
      fileExtensions: Array.isArray(config.fileExtensions) ? config.fileExtensions : ["ts", "js", "tsx"]
    };
  } catch (error) {
    // Fallback to default config
    return { sourceDirectories: ["src/", "lib/", "app/"], fileExtensions: ["ts", "js", "tsx"] };
  }
}

function normalizeSourceDirectories(sourceDirectories: string[]): string[] {
  return sourceDirectories.map(dir => dir.endsWith('/') ? dir.slice(0, -1) : dir);
}

function normalizeFileExtensions(fileExtensions: string[]): string[] {
  return fileExtensions.map(ext => ext.startsWith('.') ? ext.slice(1) : ext);
}

function buildFileExtensionRegex(extensions: string[]): RegExp {
  const escapedExts = extensions.map(ext => ext.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`\\.(${escapedExts.join('|')})$`);
}

async function getWorkspaceConfig(root: string): Promise<{ extensions: string[], regex: RegExp, sourceDirectories: string[] }> {
  const config = await readDochConfig(root);
  const extensions = normalizeFileExtensions(config.fileExtensions || ["ts", "js", "tsx"]);
  const regex = buildFileExtensionRegex(extensions);
  const sourceDirectories = normalizeSourceDirectories(config.sourceDirectories || ["src", "lib", "app"]);
  
  return { extensions, regex, sourceDirectories };
}

export async function driftNode(files: string[], root: string) {
  await validateDochRepo(root);
  const state = await loadDocState(root);
  const docsDirectory = await getDocsDirectoryFromVSCode(root);
  const { extensions, regex, sourceDirectories } = await getWorkspaceConfig(root);

  for (const rel of files) {
    const isInSourceDir = sourceDirectories.some(dir => rel.startsWith(`${dir}/`));
    if (!isInSourceDir || !regex.test(rel)) {
      console.log(`Skipping ${rel}: not in configured source directories or invalid extension`);
      continue;
    }

    let docRel: string | undefined;
    for (const dir of sourceDirectories) {
      if (rel.startsWith(`${dir}/`)) {
        docRel = rel
          .replace(new RegExp(`^${dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/`), docsDirectory)
          .replace(regex, '.md');
        break;
      }
    }

    if (!docRel) {
      console.log(`Could not determine documentation path for ${rel}, skipping.`);
      continue;
    }
    
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
  await validateDochRepo(root);
  const state = await loadDocState(root);
  const docsDirectory = await getDocsDirectoryFromVSCode(root);
  const { extensions, regex, sourceDirectories } = await getWorkspaceConfig(root);
  
  for (const docRel of files) {
    // Check if it's a markdown file
    if (!docRel.endsWith('.md')) {
      console.log(`Skipping ${docRel}: not a markdown file`);
      continue;
    }

    // Try to find corresponding source file in any source directory
    let foundSourceRel: string | undefined;
    
    for (const sourceDir of sourceDirectories) {
      // Convert docs path back to source path for this directory
      const base = docRel
        .replace(new RegExp('^' + docsDirectory.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${sourceDir}/`)
        .replace(/\.md$/, '');

      for (const ext of extensions) {
        const candidate = `${base}.${ext}`;
        const fullSrc = path.join(root, candidate);
        try {
          await fs.stat(fullSrc);
          foundSourceRel = candidate;
          break;
        } catch {
          // not found, keep looking
        }
      }
      if (foundSourceRel) {
        break;
      }
    }

    if (!foundSourceRel) {
      console.log(`No corresponding source file found for ${docRel}`);
      continue;
    }

    const fullSrc = path.join(root, foundSourceRel);
    let documented = true;
    try {
      await fs.stat(fullSrc);
    } catch {
      documented = false;
    }
    
    state[foundSourceRel] = { documented, timestamp: new Date().toISOString() };
  }
  
  await saveDocState(root, state);
  console.log(`Check: updated ${files.length} entries`);
}