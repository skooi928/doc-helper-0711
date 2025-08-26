import * as vscode from 'vscode';

/* These templates assume you'll implement commands like 
doch check, doch suggest, doch drift, and doch dependencies 
in your extension to handle the actual work. 

The hooks provide the integration points with git workflow. */

const TEMPLATE_CONFIG = `\
# .doch/config.yml
# Code and documentation patterns to monitor
codeGlobs:
  - "src/**/*.ts"
  - "src/**/*.js"
  - "src/**/*.tsx"
docGlobs:
  - "docs/**/*.md"

# Staleness detection
staleThresholdDays: 3
staleDetection:
  enabled: true
  severity: "warning"  # warning, error, or info
  checkOnSave: true
  checkOnBuild: true

# Dependency tracking
dependencies:
  trackImports: true
  notifyOnChange: true
  componentMap: ".doch/metadata/component-map.json"

# Notifications
notify:
  onStale: "vscode.window.showWarningMessage"
  onComponentChange: "vscode.window.showInformationMessage"
  viaEmail: false
  emailConfig: ".doch/metadata/email-config.json"
  viaPRComment: true

# Suggestion generation
suggestions:
  enabled: true
  useAI: true
  aiModel: "openai/gpt-4"
  promptTemplate: ".doch/templates/update-snippets/default-prompt.md"
  outputDir: ".doch/suggestions"

# Diff settings for change detection
diff:
  tool: "git-diff"
  contextLines: 3
  ignoreWhitespace: true
  trackRenames: true
`;

// Check doc drifting
const HOOK_POST_MERGE = `#!/usr/bin/env sh
# .doch/hooks/post-merge
echo "DocHelper: Checking for documentation drift after merge..."

# Get all files changed in the merge
CHANGED_FILES=$(git diff HEAD@{1} --name-only | grep -E '\\.(ts|js|tsx)$')

if [ -n "$CHANGED_FILES" ]; then
  # Check for doc drift based on merged changes
  echo "$CHANGED_FILES" | xargs doch drift

  # Generate doc update suggestions based on merge
  echo "$CHANGED_FILES" | xargs doch suggest --save
  
  # Notify about dependent components affected
  doch dependencies --affected

  # Summary notification
  echo "📝 Run 'doch review' to see documentation that needs updating"
fi
`;

export async function initDochRepo(folder: vscode.WorkspaceFolder) {
  const base = vscode.Uri.joinPath(folder.uri, '.doch');

  try {
    // Check if they are any existing .doch folder (WHICH IS SUPPOSED TO BE IMPOSSIBLE)
    await vscode.workspace.fs.stat(base);
    return;
  } catch {
    // create the root .doch folder
    await vscode.workspace.fs.createDirectory(base);
  }

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
    ['hooks/post-merge', HOOK_POST_MERGE]
  ] as [string,string][]) {
    // create the file
    await vscode.workspace.fs.writeFile(
      vscode.Uri.joinPath(base, rel),
      Buffer.from(content, 'utf8')
    );
  }

  // // 3) Generate dynamic mappings
  // const dynamic = await generateDynamicMappings(folder);
  // await vscode.workspace.fs.writeFile(
  //   vscode.Uri.joinPath(base, 'mappings.json'),
  //   Buffer.from(
  //     JSON.stringify({ 'module-to-doc': dynamic }, null, 2),
  //     'utf8'
  //   )
  // );

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
