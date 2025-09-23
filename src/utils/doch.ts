import * as vscode from 'vscode';
import * as yaml from 'js-yaml';

const TEMPLATE_CONFIG = `\
# .doch/config.yml
# Source directories to monitor
sourceDirectories:
  - "src/"
  - "lib/"
  - "app/"

# File extensions to monitor (without the dot)
fileExtensions:
  - "ts"
  - "js"
  - "tsx"
`;

// Files and directories to ignore
const TEMPLATE_IGNORE = `# .dochignore
# Exclude DocHelper’s own data and caches
.doch/**
node_modules/**
dist/**
`;

// Check doc drifting and update doc-state.json after each commit
const HOOK_POST_COMMIT = `#!/usr/bin/env sh
echo "DocHelper: Updating doc status…"

# Read file extensions from config.yml
CONFIG_FILE=".doch/config.yml"
if [ -f "$CONFIG_FILE" ]; then
  # Extract fileExtensions from YAML and build regex pattern
  EXTENSIONS=$(grep -A 10 "fileExtensions:" "$CONFIG_FILE" | grep "^  - " | sed 's/^  - "//g' | sed 's/"$//g' | tr '\n' '|' | sed 's/|$//')
  if [ -n "$EXTENSIONS" ]; then
    PATTERN="\\\\.(\${EXTENSIONS}|md)$"
  else
    # Fallback to defaults if no extensions found
    PATTERN="\\\\.(ts|js|tsx|md)$"
  fi
else
  # Fallback to defaults if no config file
  PATTERN="\\\\.(ts|js|tsx|md)$"
fi

# Check if this is the first commit (no parent)
if git rev-parse --verify HEAD~1 >/dev/null 2>&1; then
  # Not the first commit - compare with previous commit
  CHANGED_SRC=$(git diff-tree --no-commit-id --name-only -r HEAD | grep -E "\${PATTERN}")
else
  # First commit - get all files in this commit
  CHANGED_SRC=$(git diff-tree --no-commit-id --name-only -r --root HEAD | grep -E "\${PATTERN}")
fi

if [ -n "$CHANGED_SRC" ]; then
  echo "$CHANGED_SRC" | xargs npx doch drift
fi 
`;

// Warn pushing to github if there are undocumented or stale .md files
// If pushing directly to main/master, block it
const HOOK_PRE_PUSH = `#!/usr/bin/env sh
echo "DocHelper: Checking documentation status before push…"

# Check if pushing to main branch
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
PUSHING_TO_MAIN=false

# Check if any of the push destinations is main/master
while read local_ref local_sha remote_ref remote_sha; do
  if [ "$remote_ref" = "refs/heads/main" ] || [ "$remote_ref" = "refs/heads/master" ]; then
    PUSHING_TO_MAIN=true
    break
  fi
done

# Read file extensions from config.yml
CONFIG_FILE=".doch/config.yml"
if [ -f "$CONFIG_FILE" ]; then
  # Extract fileExtensions from YAML and build regex pattern
  EXTENSIONS=$(grep -A 10 "fileExtensions:" "$CONFIG_FILE" | grep "^  - " | sed 's/^  - "//g' | sed 's/"$//g' | tr '\n' '|' | sed 's/|$//')
  if [ -n "$EXTENSIONS" ]; then
    PATTERN="\\\\.(\${EXTENSIONS}|md)$"
  else
    # Fallback to defaults if no extensions found
    PATTERN="\\\\.(ts|js|tsx|md)$"
  fi
else
  # Fallback to defaults if no config file
  PATTERN="\\\\.(ts|js|tsx|md)$"
fi

CHANGED_MD=$(git diff --name-only origin/main...HEAD | grep -E "\${PATTERN}")
if [ -n "$CHANGED_MD" ]; then
  echo "$CHANGED_MD" | xargs npx doch check
  if [ $? -ne 0 ]; then
    echo ""
    # If pushing directly to main, block it
    if [ "$PUSHING_TO_MAIN" = true ] || ([ "$CURRENT_BRANCH" = "main" ] || [ "$CURRENT_BRANCH" = "master" ]); then
      echo "Warning: Direct push to main branch with stale documentation is not allowed!"
      exit 1
    else
      echo "🚧 Warning: Documentation is stale or missing!"
      read -p "Continue push anyway? [Y/N] " yn < /dev/tty
      if [ "$yn" = "y" ] || [ "$yn" = "Y" ]; then
        echo "Proceeding with push…"
      else
        echo "Push aborted. Please fix documentation issues first."
        exit 1
      fi
    fi
  fi
fi

exit 0
`;

// Warn merging if there are undocumented or stale .md files
const HOOK_PRE_MERGE_COMMIT = `#!/usr/bin/env sh
echo "DocHelper: Checking documentation status before merge…"

# Check if this is actually a merge (MERGE_HEAD exists)
if ! git rev-parse --verify MERGE_HEAD >/dev/null 2>&1; then
  # Not a merge, exit normally
  exit 0
fi

# Read file extensions from config.yml
CONFIG_FILE=".doch/config.yml"
if [ -f "$CONFIG_FILE" ]; then
  # Extract fileExtensions from YAML and build regex pattern
  EXTENSIONS=$(grep -A 10 "fileExtensions:" "$CONFIG_FILE" | grep "^  - " | sed 's/^  - "//g' | sed 's/"$//g' | tr '\n' '|' | sed 's/|$//')
  if [ -n "$EXTENSIONS" ]; then
    PATTERN="\\\\.(\${EXTENSIONS}|md)$"
  else
    # Fallback to defaults if no extensions found
    PATTERN="\\\\.(ts|js|tsx|md)$"
  fi
else
  # Fallback to defaults if no config file
  PATTERN="\\\\.(ts|js|tsx|md)$"
fi

# Get markdown files that would be affected by the merge
CHANGED_MD=$(git diff --name-only HEAD MERGE_HEAD | grep -E "\${PATTERN}")
if [ -n "$CHANGED_MD" ]; then
  echo "$CHANGED_MD" | xargs npx doch check
  if [ $? -ne 0 ]; then
    echo ""
    # Just warning
    echo "🚧 Warning: Documentation is stale or missing in merge!"
    read -p "Continue merge anyway? [y/N] " yn < /dev/tty
    if [ "$yn" = "y" ] || [ "$yn" = "Y" ]; then
      echo "Proceeding with merge…"
    else
      echo "Merge aborted. Please fix documentation issues first."
      exit 1
    fi
  fi
fi

exit 0
`;

// Update drift after merging (similar logic to post-commit)
const HOOK_POST_MERGE = `#!/usr/bin/env sh
echo "DocHelper: Updating documentation status after merge…"

# Read file extensions from config.yml
CONFIG_FILE=".doch/config.yml"
if [ -f "$CONFIG_FILE" ]; then
  # Extract fileExtensions from YAML and build regex pattern
  EXTENSIONS=$(grep -A 10 "fileExtensions:" "$CONFIG_FILE" | grep "^  - " | sed 's/^  - "//g' | sed 's/"$//g' | tr '\n' '|' | sed 's/|$//')
  if [ -n "$EXTENSIONS" ]; then
    PATTERN="\\\\.(\${EXTENSIONS}|md)$"
  else
    # Fallback to defaults if no extensions found
    PATTERN="\\\\.(ts|js|tsx|md)$"
  fi
else
  # Fallback to defaults if no config file
  PATTERN="\\\\.(ts|js|tsx|md)$"
fi

# Check if ORIG_HEAD exists (indicates a merge just happened)
if git rev-parse --verify ORIG_HEAD >/dev/null 2>&1; then
  # Get files that were changed in the merge
  CHANGED_SRC=$(git diff-tree --no-commit-id --name-only -r ORIG_HEAD HEAD | grep -E "\${PATTERN}")
else
  # Fallback: compare with previous commit
  if git rev-parse --verify HEAD~1 >/dev/null 2>&1; then
    CHANGED_SRC=$(git diff-tree --no-commit-id --name-only -r HEAD~1 HEAD | grep -E "\${PATTERN}")
  else
    # First commit - get all files
    CHANGED_SRC=$(git diff-tree --no-commit-id --name-only -r --root HEAD | grep -E "\${PATTERN}")
  fi
fi

if [ -n "$CHANGED_SRC" ]; then
  echo "$CHANGED_SRC" | xargs npx doch drift
fi
`;

// ABOUT DOCH REPO
export async function initDochRepo(folder: vscode.WorkspaceFolder) {
  const base = vscode.Uri.joinPath(folder.uri, '.doch');

  // Initialize .dochignore
  const ignoreUri = vscode.Uri.joinPath(folder.uri, '.dochignore');
  try {
    await vscode.workspace.fs.stat(ignoreUri);
  } catch {
    await vscode.workspace.fs.writeFile(
      ignoreUri,
      Buffer.from(TEMPLATE_IGNORE, 'utf8')
    );
  }

  try {
    // Check if they are any existing .doch folder
    await vscode.workspace.fs.stat(base);
    return;
  } catch {
    // create the root .doch folder
    await vscode.workspace.fs.createDirectory(base);
  }

  // Should not gitignore so every branch has their own doc status
  // // Ensure .gitignore exists and includes .doch/ and .dochignore
  // const gitignoreUri = vscode.Uri.joinPath(folder.uri, '.gitignore');
  // let gitContent = '';
  // try {
  //   const buf = await vscode.workspace.fs.readFile(gitignoreUri);
  //   gitContent = Buffer.from(buf).toString('utf8');
  // } catch {
  //   // no .gitignore → create one with header
  //   const header = '# .gitignore (generated by DocHelper)\n\n';
  //   await vscode.workspace.fs.writeFile(
  //     gitignoreUri,
  //     Buffer.from(header, 'utf8')
  //   );
  //   gitContent = header;
  // }
  // const lines = gitContent.split(/\r?\n/);
  // const toAdd = ['.doch/', '.dochignore'].filter(p => !lines.includes(p));
  // if (toAdd.length) {
  //   const suffix = gitContent.endsWith('\n') ? '' : '\n';
  //   const newContent = gitContent + suffix + toAdd.join('\n') + '\n';
  //   await vscode.workspace.fs.writeFile(
  //     gitignoreUri,
  //     Buffer.from(newContent, 'utf8')
  //   );
  // }

  // 1) Directories to create
  const dirs = [
    'hooks',
    'metadata',
    'cache/drift-reports',
  ];
  for (const d of dirs) {
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(base, d));
  }

  // 2) Files to seed
  for (const [rel, content] of [
    ['config.yml', TEMPLATE_CONFIG],
    ['hooks/post-commit', HOOK_POST_COMMIT],
    ['hooks/pre-push', HOOK_PRE_PUSH],
    ['hooks/pre-merge-commit', HOOK_PRE_MERGE_COMMIT],
    ['hooks/post-merge', HOOK_POST_MERGE],
    ['metadata/doc-state.json', '{}'],
  ] as [string,string][]) {
    // create the file
    await vscode.workspace.fs.writeFile(
      vscode.Uri.joinPath(base, rel),
      Buffer.from(content, 'utf8')
    );
  }

  const terminal = vscode.window.createTerminal('Doc Helper');
  terminal.show(true);
  terminal.sendText('git init');
  terminal.sendText('git config core.hooksPath .doch/hooks');
  // DEPLOYMENT NOTE:
  // terminal.sendText('npm install -g doc-helper-0711');

  // Ensure the workspace .vscode folder and add markdown quickSuggestions
  const vscodeConfigDir = vscode.Uri.joinPath(folder.uri, '.vscode');
  await vscode.workspace.fs.createDirectory(vscodeConfigDir);
  const settingsUri = vscode.Uri.joinPath(vscodeConfigDir, 'settings.json');

  let settings: any = {};
  try {
    const settingsContent = await vscode.workspace.fs.readFile(settingsUri);
    settings = JSON.parse(Buffer.from(settingsContent).toString('utf8'));
  } catch {
    // no existing settings → start fresh
  }

  settings['[markdown]'] = settings['[markdown]'] || {};
  settings['[markdown]']['editor.snippetSuggestions'] = "top";
  settings['[markdown]']['editor.quickSuggestions'] = true;
  settings['[markdown]']['editor.suggest.showWords'] = false;

  await vscode.workspace.fs.writeFile(
    settingsUri,
    Buffer.from(JSON.stringify(settings, null, 2), 'utf8')
  );

  vscode.window.showInformationMessage(`Initialized .doch in "${folder.name}"`);
}

export async function updateDochContext() {
  const folders = vscode.workspace.workspaceFolders || [];
  let initialized = false;
  for (const folder of folders) {
    try {
      await vscode.workspace.fs.stat(vscode.Uri.joinPath(folder.uri, '.doch', 'config.yml'));
      initialized = true;
      break;
    } catch {
      // not found = keep looking
    }
  }
  // tell VS Code to re-evaluate when-clauses
  await vscode.commands.executeCommand('setContext', 'docHelper:dochInitialized', initialized);
}

// ABOUT FILE LEVEL
// detect changes to doc-state.json to dynamically update status bar
export function watchDocState(onChange: () => void): vscode.Disposable {
  const watcher = vscode.workspace.createFileSystemWatcher(
      '**/.doch/metadata/doc-state.json'
  );
  watcher.onDidCreate(onChange);
  watcher.onDidChange(onChange);
  watcher.onDidDelete(onChange);
  return watcher;
}

// Read doch config.yml file
export interface DochConfig {
  sourceDirectories?: string[];
  fileExtensions?: string[];
}

async function readDochConfig(workspaceFolder: vscode.WorkspaceFolder): Promise<DochConfig> {
  const configUri = vscode.Uri.joinPath(workspaceFolder.uri, '.doch', 'config.yml');
  
  try {
    const configBuffer = await vscode.workspace.fs.readFile(configUri);
    const configContent = Buffer.from(configBuffer).toString('utf8');
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

// Normalize source directories (remove trailing slash)
function normalizeSourceDirectories(sourceDirectories: string[]): string[] {
  return sourceDirectories.map(dir => dir.endsWith('/') ? dir.slice(0, -1) : dir);
}

// Normalize file extensions (remove leading dot)
function normalizeFileExtensions(fileExtensions: string[]): string[] {
  return fileExtensions.map(ext => ext.startsWith('.') ? ext.slice(1) : ext);
}

function buildFileExtensionRegex(extensions: string[]): RegExp {
  const escapedExts = extensions.map(ext => ext.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`\\.(${escapedExts.join('|')})$`);
}

// Cache for configs per workspace
const configCache = new Map<string, { extensions: string[], regex: RegExp, sourceDirectories: string[] }>();

export async function getWorkspaceConfig(workspaceFolder: vscode.WorkspaceFolder): Promise<{ extensions: string[], regex: RegExp, sourceDirectories: string[] }> {
  const key = workspaceFolder.uri.toString();
  
  if (!configCache.has(key)) {
    const config = await readDochConfig(workspaceFolder);
    const extensions = normalizeFileExtensions(config.fileExtensions || ["ts", "js", "tsx"]);
    const regex = buildFileExtensionRegex(extensions);
    const sourceDirectories = normalizeSourceDirectories(config.sourceDirectories || ["src", "lib", "app"]);
    
    configCache.set(key, { extensions, regex, sourceDirectories });
  }
  
  return configCache.get(key)!;
}

export function clearConfigCache(): void {
  configCache.clear();
}

export function createConfigWatcher(context: vscode.ExtensionContext, onConfigChange?: () => void): vscode.FileSystemWatcher {
  const configWatcher = vscode.workspace.createFileSystemWatcher('**/.doch/config.yml');
  
  configWatcher.onDidChange(() => {
    clearConfigCache(); // Clear cache to reload config
    if (onConfigChange) {
      onConfigChange();
    }
  });
  
  configWatcher.onDidCreate(() => {
    clearConfigCache();
    if (onConfigChange) {
      onConfigChange();
    }
  });
  
  configWatcher.onDidDelete(() => {
    clearConfigCache();
    if (onConfigChange) {
      onConfigChange();
    }
  });
  
  context.subscriptions.push(configWatcher);
  return configWatcher;
}