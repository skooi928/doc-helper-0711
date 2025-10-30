import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';
import { minimatch } from 'minimatch';
import { execSync } from 'child_process';

export interface DocState {
  [sourceRel: string]: {
    documented: boolean;
    timestamp: string;
    docTime?: string;
    status?: 'uptodate' | 'outdated' | 'nodocs';
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
    throw new Error(`DocHelper not initialized. Initialize from VS Code extension first.\nMissing: ${dochDir}`);
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

// Read .dochignore and return non-comment, non-blank lines
async function loadIgnorePatterns(root: string): Promise<string[]> {
  const ignorePath = path.join(root, '.dochignore');
  try {
    const raw = await fs.readFile(ignorePath, 'utf8');
    return raw
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'));
  } catch {
    return [];
  }
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
        
        const docsDir = settings['docHelper.saveDirectory'];
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

async function getLastCommitMessage(filePath: string, root: string): Promise<string> {
  try {
    const relativePath = path.relative(root, filePath).replace(/\\/g, '/');
    const output = execSync(
      `git log -n 1 --pretty=format:"%s" -- "${relativePath}"`,
      { cwd: root, encoding: 'utf8' }
    );
    return output.trim();
  } catch (error) {
    console.log(`Could not get commit message for ${filePath}: ${error}`);
    return '';
  }
}

export async function driftNode(files: string[], root: string) {
  await validateDochRepo(root);
  const ignorePatterns = await loadIgnorePatterns(root);
  const state = await loadDocState(root);
  const docsDirectory = await getDocsDirectoryFromVSCode(root);
  const { extensions, regex, sourceDirectories } = await getWorkspaceConfig(root);

  for (const rel of files) {
    // Check ignore patterns
    if (ignorePatterns.some(pattern => minimatch(rel, pattern))) {
      continue;
    }

    const isInSourceDir = sourceDirectories.some(dir => rel.startsWith(`${dir}/`));
    if ((!isInSourceDir || !regex.test(rel)) && !rel.startsWith(docsDirectory)) {
      continue;
    }

    let srcRel: string | undefined;
    let docRel: string | undefined;

    if (rel.startsWith(docsDirectory) && rel.endsWith('.md')) {
      // Documentation file logic - find corresponding source file
      for (const dir of sourceDirectories) {
        const base = rel
          .replace(new RegExp('^' + docsDirectory.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${dir}/`)
          .replace(/\.md$/, '');
        for (const ext of extensions) {
          const candidate = `${base}.${ext}`;
          const fullSrc = path.join(root, candidate);
          try {
            await fs.stat(fullSrc);
            srcRel = candidate;
            docRel = rel;
            break;
          } catch {
            // not found, keep looking
          }
        }
        if (srcRel && docRel) {
          break;
        }
      }
    } else {
      // Source file logic - find corresponding doc file
      for (const dir of sourceDirectories) {
        if (rel.startsWith(`${dir}/`)) {
          srcRel = rel;
          docRel = rel
            .replace(new RegExp(`^${dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/`), docsDirectory)
            .replace(regex, '.md');
          break;
        }
      }
    }

    if (!docRel || !srcRel) {
      console.log(`Could not determine corresponding source/documentation path for ${rel}, skipping.`);
      continue;
    }
    
    const fullDoc = path.join(root, docRel);
    const fullSrc = path.join(root, srcRel);

    try {
      const docStat = await fs.stat(fullDoc);
      const srcStat = await fs.stat(fullSrc);

      let docTime: string | undefined;
      let srcTime: string | undefined;
      // Get timestamps
      if (files.includes(docRel) && files.includes(srcRel)) {
        // Both files changed in this run
        docTime = new Date().toISOString();
        srcTime = new Date().toISOString();
      } else if (files.includes(docRel)) {
        // Only doc changed
        docTime = new Date().toISOString();
        srcTime = state[srcRel]?.timestamp || srcStat.mtime.toISOString();
      } else {
        // Only source changed
        srcTime = new Date().toISOString();
        docTime = state[srcRel]?.docTime || new Date(0).toISOString();
      }

      // Compare timestamps
      if (docTime >= srcTime) {
        state[srcRel] = {  
          documented: true, 
          timestamp: srcTime,
          docTime: docTime,
          status: 'uptodate'
        };
      } else {
        // Source is newer than doc - check commit message
        const commitMessage = await getLastCommitMessage(fullSrc, root);
        const minorChangeKeywords = ['fix', 'bug', 'refactor'];
        
        if (minorChangeKeywords.some(keyword => 
            commitMessage.toLowerCase().includes(keyword))) {
          // Minor change that doesn't require doc update
          state[srcRel] = { 
            documented: true, 
            timestamp: srcTime,
            docTime: docTime,
            status: 'uptodate' 
          };
        } else {
          // Major change, docs are outdated
          state[srcRel] = { 
            documented: true, 
            timestamp: srcTime,
            docTime: docTime,
            status: 'outdated' 
          };
        }
      }
    } catch (error) {
      console.error(`Error processing ${srcRel}: ${error}`);
        state[srcRel] = { 
        documented: false, 
        timestamp: new Date().toISOString(),
        status: 'nodocs'
      };
    }
  }
  await saveDocState(root, state);
  console.log(`Drift: updated ${files.length} files`);
}

export async function checkNode(files: string[], root: string) {
  await validateDochRepo(root);
  const ignorePatterns = await loadIgnorePatterns(root);
  const state = await loadDocState(root);
  const docsDirectory = await getDocsDirectoryFromVSCode(root);
  const { extensions, regex, sourceDirectories } = await getWorkspaceConfig(root);
  
  for (const rel of files) {
    // Check ignore patterns
    if (ignorePatterns.some(pattern => minimatch(rel, pattern))) {
      continue;
    }

    const isInSourceDir = sourceDirectories.some(dir => rel.startsWith(`${dir}/`));
    if ((!isInSourceDir || !regex.test(rel)) && !rel.startsWith(docsDirectory)) {
      continue;
    }

    let srcRel: string | undefined;
    let docRel: string | undefined;
    
    if (rel.startsWith(docsDirectory) && rel.endsWith('.md')) {
      docRel = rel;
      for (const sourceDir of sourceDirectories) {
        // Convert docs path back to source path for this directory
        const base = rel
          .replace(new RegExp('^' + docsDirectory.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${sourceDir}/`)
          .replace(/\.md$/, '');

        for (const ext of extensions) {
          const candidate = `${base}.${ext}`;
          const fullSrc = path.join(root, candidate);
          try {
            await fs.stat(fullSrc);
            srcRel = candidate;
            break;
          } catch {
            // not found, keep looking
          }
        }
        if (srcRel) {
          break;
        }
      }

      if (!srcRel) {
        console.log(`No corresponding source file found for ${docRel}`);
        continue;
      }

      if (srcRel) {
        const entry = state[srcRel];
        if (!entry) {
          console.log(`${srcRel}: no state entry`);
          process.exit(1);
        } else if (entry.status !== 'uptodate') {
          console.log(`${srcRel}: status is '${entry.status}'`);
          process.exit(1);
        } else {
          process.exit(0);
        }
      }
    } else {
      srcRel = rel;
      const entry = state[srcRel];
      if (!entry) {
        console.log(`${srcRel}: no state entry`);
        process.exit(1);
      } else if (entry.status !== 'uptodate') {
        console.log(`${srcRel}: status is '${entry.status}'`);
        process.exit(1);
      } else {
        process.exit(0);
      }
    }
  }
  
  await saveDocState(root, state);
  console.log(`Check: updated ${files.length} entries`);
}