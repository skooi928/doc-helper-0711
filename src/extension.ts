import * as vscode from 'vscode';
import { initDochRepo, updateDochContext, watchDocState } from './utils/doch';

export function activate(context: vscode.ExtensionContext) {
  // Update on start
  updateDochContext();

  // watch for changes in .doch
  const watcher = vscode.workspace.createFileSystemWatcher('**/.doch/**');
  watcher.onDidCreate(() => updateDochContext());
  watcher.onDidDelete(() => updateDochContext());
  context.subscriptions.push(watcher);

  // Initialize .doch folder when opened a new folder
  // Register a one‐off “init repo” command
  const initCmd = vscode.commands.registerCommand(
    'doc-helper-0711.initDochRepo',
    async () => {
      // first prompt to open a folder if none is open
      if (!vscode.workspace.workspaceFolders?.length) {
        await vscode.commands.executeCommand('vscode.openFolder');
      }
      // then initialise .doch in every open folder
      vscode.workspace.workspaceFolders?.forEach(initDochRepo);
      await vscode.commands.executeCommand(
        'setContext',
        'docHelper:dochInitialized',
        true
      );
    }
  );
  context.subscriptions.push(initCmd);

  // Show status of the opened file
  // create status bar item
  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    /*priority, higher value to the left*/ 1
  );
  context.subscriptions.push(statusBarItem);

  // function to load json state from .doch/metadata/doc-state.json
  async function loadState(): Promise<Record<string, { documented: boolean; timestamp: string }>> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) {
      return {};
    }
    const folder = folders[0];
    const stateUri = vscode.Uri.joinPath(folder.uri, '.doch', 'metadata', 'doc-state.json');
    try {
      const buf = await vscode.workspace.fs.readFile(stateUri);
      return JSON.parse(buf.toString());
    } catch {
      return {};
    }
  }

  // function to update status bar based on active editor and loaded state
  async function updateStatus(editor?: vscode.TextEditor) {
    if (!editor) {
      statusBarItem.hide();
      return;
    }

    const uri = editor.document.uri;
    const rel = vscode.workspace.asRelativePath(uri, false);
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) { // Check for file but not inside the same workspace
      statusBarItem.hide();
      return;
    }
    const folder = folders[0];
    const state = await loadState();
    let text: string | undefined;

    if (/\.(ts|js|tsx)$/.test(rel)) {
      // code file → check doc exists?
      const docRel = rel
        .replace(/^src[\/\\]/, 'docs/')
        .replace(/\.(ts|js|tsx)$/, '.md');
      const entry = state[rel];
      if (entry) {
        text = entry.documented
          ? '$(check) Documented'
          : '$(alert) Undocumented';
      } else {
        text = '$(alert) Staled';
      }
    } else if (/\.md$/.test(rel)) {
      // markdown → try all source extensions
      const base = rel
        .replace(/^docs[\/\\]/, 'src/')
        .replace(/\.md$/, '');

      const exts = ['ts', 'js', 'tsx'];
      let foundExt: string|undefined;
      for (const ext of exts) {
        const candidate = `${base}.${ext}`;
        try {
          await vscode.workspace.fs.stat(
            vscode.Uri.joinPath(folder.uri, ...candidate.split(/[\\/]/))
          );
          foundExt = ext;
          break;
        } catch {
          // not found, keep looking
        }
      }

      if (foundExt) {
        // there is a matching source file
        const entry = state[`${base}.${foundExt}`];
        text = entry?.documented
          ? '$(check) Sync'
          : '$(alert) Not Sync';
      } else {
        // no matching source at all
        text = '$(alert) No matched source';
      }
    }

    if (text) {
      statusBarItem.text = text;
      statusBarItem.tooltip = `Documentation status for ${rel}`;

      // set background color based on status
      if (text.includes('Staled') || text.includes('No matched source')) {
        statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
      } else if (text.includes('Undocumented') || text.includes('Not Sync')) {
        statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
      } else {
        statusBarItem.backgroundColor = undefined;
      }

      statusBarItem.show();
    } else {
      statusBarItem.hide();
    }
  }

  // Initial call
  updateStatus(vscode.window.activeTextEditor); // for when the vsc first opens
  
  // listen for editor changes
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(updateStatus)
  );

  // any time the JSON changes, re-run your status‐bar update
  context.subscriptions.push(
    watchDocState(() => updateStatus(vscode.window.activeTextEditor))
  );
}

export function deactivate() {}