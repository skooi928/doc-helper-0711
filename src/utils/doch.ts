import * as vscode from 'vscode';

const TEMPLATE_CONFIG = `\
# .doch/config.yml
codeGlobs:
  - "src/**/*.ts"
docGlobs:
  - "docs/**/*.md"
staleThresholdDays: 7
notify:
  onStale: "vscode.window.showWarningMessage"
  onComponentChange: "git-pr-comment"
diff:
  tool: "git-diff"
  contextLines: 3
`;

const TEMPLATE_MAPPINGS = `\
{
  "module-to-doc": {
    "src/utils/doch.ts": "docs/doch.md",
    "src/extension.ts": "docs/extension.md"
  }
}
`;

const HOOK_PRE_COMMIT = `#!/usr/bin/env sh
# .doch/hooks/pre-commit
echo "Running doc lint..."
# e.g. doch lint
`;

const HOOK_POST_MERGE = `#!/usr/bin/env sh
# .doch/hooks/post-merge
echo "Checking for doc drift..."
# e.g. doch drift
`;

export async function initDochRepo(folder: vscode.WorkspaceFolder) {
  const base = vscode.Uri.joinPath(folder.uri, '.doch');

  try {
    await vscode.workspace.fs.stat(base);
    return; // already exists
  } catch {
    // create the root .doch folder
    await vscode.workspace.fs.createDirectory(base);
  }

  // 1) directories to create
  const dirs = [
    'hooks',
    'metadata',
    'cache/drift-reports',
    'templates/update-snippets',
    'suggestions'
  ];
  for (const d of dirs) {
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(base, d));
  }

  // 2) files to seed
  const files: [string, string][] = [
    ['README.md', '# DocHelper repo\nThis folder contains doc‐maintenance state.'],
    ['config.yml', TEMPLATE_CONFIG],
    ['mappings.json', TEMPLATE_MAPPINGS],
    ['hooks/pre-commit', HOOK_PRE_COMMIT],
    ['hooks/post-merge', HOOK_POST_MERGE],
  ];

  for (const [rel, content] of files) {
    const uri = vscode.Uri.joinPath(base, rel);
    await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
    // make hooks executable on disk (Unix)
    if (rel.startsWith('hooks/')) {
      try {
        // @ts-ignore
        await vscode.workspace.fs.stat(uri); // ensure file exists before chmod
        // not part of VS Code API but if you drop to Node:
        // require('fs').chmodSync(uri.fsPath, 0o755);
      } catch { /* ignore */ }
    }
  }

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