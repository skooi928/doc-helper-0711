import * as vscode from 'vscode';
import { initDochRepo, updateDochContext, watchDocState } from './utils/doch';
import { ChatbotViewProvider } from './providers/chatbotViewProvider'; 
import { FileStatusItem, FileStatusProvider } from './providers/fileStatusProvider';

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

  // Webview after the doch repo is initialized
	const chatbotViewProvider = new ChatbotViewProvider(context.extensionUri); 
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(ChatbotViewProvider.viewType, chatbotViewProvider)
	);

  // Register fileStatus provider for the tree view
  const fileStatusProvider = new FileStatusProvider(context);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('doc-helper-stats', fileStatusProvider),
    vscode.commands.registerCommand('doc-helper-0711.refreshFileStatus', () => fileStatusProvider.refresh()),
    vscode.commands.registerCommand('doc-helper-0711.generateDoc', async (item: FileStatusItem) => {
      if (item.fileUri) {
        vscode.window.showInformationMessage(`Doc Helper: Generating documentation for ${item.label}...`);
        // TODO: Call your AI service to generate docs
      }
    }),
    vscode.commands.registerCommand('doc-helper-0711.openFile', (uri: vscode.Uri) => {
      vscode.window.showTextDocument(uri);
    })
  );

  // Refresh on any source/docs change
  const codeWatcher = vscode.workspace.createFileSystemWatcher('**/*.{ts,js,tsx,jsx,md}');
  codeWatcher.onDidCreate(() => fileStatusProvider.refresh());
  codeWatcher.onDidChange(() => fileStatusProvider.refresh());
  codeWatcher.onDidDelete(() => fileStatusProvider.refresh());
  context.subscriptions.push(codeWatcher);

  // Refresh when doc-state.json changes
  const docStateWatcher = vscode.workspace.createFileSystemWatcher('**/.doch/metadata/doc-state.json');
  docStateWatcher.onDidCreate(() => fileStatusProvider.refresh());
  docStateWatcher.onDidChange(() => fileStatusProvider.refresh());
  docStateWatcher.onDidDelete(() => fileStatusProvider.refresh());
  context.subscriptions.push(docStateWatcher);

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
    let bg: vscode.ThemeColor | undefined;

    if (/\.(ts|js|tsx)$/.test(rel)) {
      // code file, check doc exists?
      const docRel = rel
        .replace(/^src[\/\\]/, 'docs/')
        .replace(/\.(ts|js|tsx)$/, '.md');
      const docUri = vscode.Uri.joinPath(folder.uri, ...docRel.split(/[\\/]/));
      let docExists = false;
      let docMtime = 0; // modification time
      try {
        const stat = await vscode.workspace.fs.stat(docUri);
        docExists = true;
        docMtime = stat.mtime;
      } catch {
        // not found
      }

      const codeUri = vscode.Uri.joinPath(folder.uri, ...rel.split(/[\\/]/));
      const codeStat = await vscode.workspace.fs.stat(codeUri);
      const codeTime = Math.max(codeStat.ctime, codeStat.mtime);
      const docStat = docExists ? await vscode.workspace.fs.stat(docUri) : undefined;
      const docTime = docStat ? Math.max(docStat.ctime, docStat.mtime) : 0;
      const entry = state[rel];
      const commitTime = entry ? Date.parse(entry.timestamp) : undefined;

      if (!docExists) {
        text = '$(alert) Undocumented';
        bg = new vscode.ThemeColor('statusBarItem.errorBackground');
      }
      else if (entry && commitTime !== undefined && ((commitTime < codeTime) || (commitTime < docTime))) {
        text = '$(alert) Stale';
        bg = new vscode.ThemeColor('statusBarItem.warningBackground');
      }
      else if (entry && entry.documented) {
        text = '$(check) Documented';
        bg = undefined;
      }
      else {
        text = '$(circle-outline) Docs Uncommitted';
        bg = new vscode.ThemeColor('statusBarItem.errorBackground');
      }
    } else if (/\.md$/.test(rel)) {
      // markdown file, try all source extensions
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

      if (!foundExt) {
        // no matching source at all
        text = '$(alert) No matched source';
        bg  = new vscode.ThemeColor('statusBarItem.warningBackground');
      } else {
        const srcRel = `${base}.${foundExt}`;
        const codeUri = vscode.Uri.joinPath(folder.uri, ...srcRel.split(/[\\/]/));
        const srcStat = await vscode.workspace.fs.stat(codeUri);
        const codeTime = Math.max(srcStat.ctime, srcStat.mtime);
        const docsStat = await vscode.workspace.fs.stat(uri);
        const docsTime = Math.max(docsStat.ctime, docsStat.mtime);
        const entry = state[srcRel];
        const commitTime = entry ? Date.parse(entry.timestamp) : undefined;

        if (entry && commitTime !== undefined && ((commitTime < codeTime) || (commitTime < docsTime))) {
          text = '$(alert) Stale';
          bg = new vscode.ThemeColor('statusBarItem.warningBackground');
        }
        else if (entry && entry.documented) {
          text = '$(check) Sync';
          bg = undefined;
        }
        else {
          text = '$(circle-outline) Uncommitted Docs';
          bg = new vscode.ThemeColor('statusBarItem.errorBackground');
        }
      }
    }

    if (text) {
      statusBarItem.text = text;
      statusBarItem.tooltip = `Documentation status for ${rel}`;
      statusBarItem.backgroundColor = bg;
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