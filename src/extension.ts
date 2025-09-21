import * as vscode from 'vscode';

const outputChannel = vscode.window.createOutputChannel('Doc Helper Logs');
import * as path from 'path';
import { AIService } from './ai/temporaryAI';
import { initDochRepo, updateDochContext, watchDocState } from './utils/doch';
import { ChatbotViewProvider } from './providers/chatbotViewProvider'; 
import { FileStatusItem, FileStatusProvider } from './providers/fileStatusProvider';
import { registerFileLinkingProviders } from './providers/fileLinkingProvider';
import { registerMissingDocCodeActions } from './providers/missingDocCodeActionProvider';
import { registerWrongNumberingCodeActions } from './providers/wrongNumberingCodeActionProvider';
import { generateDocumentation, summarizeDocumentation, checkDocumentation, registerInlineSuggestionProvider, summarizeAllDocsWithReview } from './utils/simplifyWriting';

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('doc-helper-0711.generateComment', async (fileUri?: vscode.Uri) => {
      await require('./utils/simplifyWriting').generateCommentAndInsert(fileUri);
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('doc-helper-0711.summarizeAllDocs', async () => {
      await summarizeAllDocsWithReview(context);
    })
  );
  const aiService = new AIService();
  context.subscriptions.push(
    vscode.commands.registerCommand('doc-helper-0711.UpdateDoc', async (item: FileStatusItem) => {
      const docUri = item?.fileUri;
      if (!docUri || !docUri.fsPath) {
        vscode.window.showErrorMessage('Selected documentation is not a file on disk. Please select a markdown file that exists in your workspace.');
        return;
      }
      // Debug logging
      console.log('docUri:', docUri);
      console.log('docUri.fsPath:', docUri.fsPath);
      try {
        // Read original documentation
        const originalContent = Buffer.from(await vscode.workspace.fs.readFile(docUri)).toString('utf8');

        // Find corresponding source file
        const folders = vscode.workspace.workspaceFolders;
        if (!folders?.length) {
          throw new Error('No workspace folder found');
        }
        const config = vscode.workspace.getConfiguration('docHelper');
        const docsDirectory = config.get<string>('saveDirectory') || 'docs/';
        const docRel = vscode.workspace.asRelativePath(docUri, false);
        const base = docRel
          .replace(new RegExp('^' + docsDirectory.replace(/[.*+?^${}()|[\]"]/g, '\$&')), 'src/')
          .replace(/\.md$/, '');
        const exts = ['ts', 'tsx', 'js', 'jsx'];
        let sourceUri: vscode.Uri | undefined;
        let foundExt: string | undefined;
        for (const ext of exts) {
          const candidate = `${base}.${ext}`;
          const candidateUri = vscode.Uri.joinPath(folders[0].uri, ...candidate.split(/[\\/]/));
          try {
            await vscode.workspace.fs.stat(candidateUri);
            sourceUri = candidateUri;
            foundExt = ext;
            break;
          } catch {
            // not found
          }
        }
        if (!sourceUri || !foundExt) {
          throw new Error('Could not find corresponding source file for this documentation');
        }
        // Read source code
        const sourceContent = Buffer.from(await vscode.workspace.fs.readFile(sourceUri)).toString('utf8');
        const ext = path.extname(sourceUri.fsPath).toLowerCase();
        const language = ext === '.ts' || ext === '.tsx' ? 'typescript' : 'javascript';

        // Generate updated documentation with AI
        const updatedContent = await generateDocumentationForReview(sourceContent, language, originalContent);

        // Create a temp file for the AI-generated documentation
        const tempDocPath = docUri.fsPath + '.AI';
        const tempDocUri = vscode.Uri.file(tempDocPath);
        await vscode.workspace.fs.writeFile(tempDocUri, Buffer.from(updatedContent, 'utf8'));

        // Show diff editor: left = original, right = AI-generated
        await vscode.commands.executeCommand('vscode.diff', docUri, tempDocUri, 'Review: Original vs AI-Generated');

        // Prompt to accept/reject
        const choice = await vscode.window.showInformationMessage(
          'Do you want to accept the AI-generated documentation?',
          'Accept', 'Reject'
        );
        if (choice === 'Accept') {
          await vscode.workspace.fs.writeFile(docUri, Buffer.from(updatedContent, 'utf8'));
          vscode.window.showInformationMessage('Documentation updated!');
        } else {
          vscode.window.showInformationMessage('No changes applied.');
          await vscode.workspace.fs.delete(tempDocUri);
        }
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to review/update documentation: ${error instanceof Error ? error.message : String(error)}`);
      }
    })
  );

  // Helper for AI review command
  async function generateDocumentationForReview(code: string, language: string, context: string): Promise<string> {
    // Use the AI service to generate updated documentation, passing original as context
    return await aiService.generateDocumentation(code, language, context);
  }
    vscode.commands.registerCommand('doc-helper-0711.selectAndGenerateDocs', async () => {
      const allItems = await fileStatusProvider.getAllItems();
      const undocumented = allItems.filter(item => item.status === 'Undocumented');
      if (undocumented.length === 0) {
        vscode.window.showInformationMessage('No undocumented source files found.');
        return;
      }
      const picks = undocumented.map(item => ({
        label: item.label,
        description: vscode.workspace.asRelativePath(item.fileUri!, false),
        picked: false,
        item
      }));
      const selected = await vscode.window.showQuickPick(picks, {
        canPickMany: true,
        placeHolder: 'Select one or more files to generate documentation for'
      });
      if (!selected || selected.length === 0) {
        vscode.window.showInformationMessage('No files selected.');
        return;
      }
      vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Generating documentation for selected files...',
        cancellable: false
      }, async (progress) => {
        let completed = 0;
        for (const pick of selected) {
          progress.report({ message: `Processing ${pick.label} (${completed + 1}/${selected.length})` });
          await generateDocumentation(pick.item.fileUri!);
          completed++;
        }
        vscode.window.showInformationMessage(`Documentation generated for ${selected.length} files.`);
        fileStatusProvider.refresh();
      });
    }),
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
    vscode.commands.registerCommand('doc-helper-0711.searchFile', async () => {
      const items = await fileStatusProvider.getAllItems();
      const picks = items.map(item => ({
        label: item.label,
        description: vscode.workspace.asRelativePath(item.fileUri!, false),
        detail: `Status: ${item.status}`, 
        item
      }));
      const selection = await vscode.window.showQuickPick(picks, {
        placeHolder: 'Filter files by name or path…',
        matchOnDescription: true,
        matchOnDetail: true
      });
      if (selection?.item.fileUri) {
        await vscode.window.showTextDocument(selection.item.fileUri);
      }
    }),
    
    vscode.commands.registerCommand('doc-helper-0711.ignoreFile', async (item: FileStatusItem) => {
      if (!item.fileUri) {
        return;
      }
      const folders = vscode.workspace.workspaceFolders;
      if (!folders?.length) {
        return;
      }
      const folder = folders[0];
      const ignoreUri = vscode.Uri.joinPath(folder.uri, '.dochignore');

      // ensure .dochignore exists, create empty if missing
      try {
        await vscode.workspace.fs.stat(ignoreUri);
      } catch {
        const header = '# .dochignore';
        await vscode.workspace.fs.writeFile(ignoreUri, Buffer.from(header, 'utf8'));
      }

      // read existing .dochignore
      let content = '';
      try {
        const buf = await vscode.workspace.fs.readFile(ignoreUri);
        content = Buffer.from(buf).toString('utf8');
      } catch {
        // should not happen as we just created it
      }

      // compute normalized relative path
      const rel = vscode.workspace.asRelativePath(item.fileUri, false).replace(/\\/g, '/');
      const lines = content.split(/\r?\n/);
      if (!lines.includes(rel)) {
        const newContent = content + (content.endsWith('\n') ? '' : '\n') + rel + '\n';
        await vscode.workspace.fs.writeFile(ignoreUri, Buffer.from(newContent, 'utf8'));
        vscode.window.showInformationMessage(`Added "${rel}" to .dochignore`);
      } else {
        vscode.window.showInformationMessage(`"${rel}" is already in .dochignore`);
      }
      fileStatusProvider.refresh();
    }),
    vscode.commands.registerCommand('doc-helper-0711.refreshFileStatus', () => fileStatusProvider.refresh()),
    vscode.commands.registerCommand('doc-helper-0711.generateDoc', async (item: FileStatusItem) => {
      if (item.fileUri) {
        // TODO: Call your AI service to generate docs
        await generateDocumentation(item.fileUri);
      }
    }),
    vscode.commands.registerCommand('doc-helper-0711.summarizeDoc', async (item: FileStatusItem) => {
      if (item.fileUri) {
        await summarizeDocumentation(item.fileUri);
      }
    }),
    vscode.commands.registerCommand('doc-helper-0711.checkDocIssue', async (item: FileStatusItem) => {
      if (item.fileUri) {
        await checkDocumentation(item.fileUri);
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

  // Refresh when .dochignore changes
  const dochIgnoreWatcher = vscode.workspace.createFileSystemWatcher('**/.dochignore');
  dochIgnoreWatcher.onDidCreate(() => fileStatusProvider.refresh());
  dochIgnoreWatcher.onDidChange(() => fileStatusProvider.refresh());
  dochIgnoreWatcher.onDidDelete(() => fileStatusProvider.refresh());
  context.subscriptions.push(dochIgnoreWatcher);

  const config = vscode.workspace.getConfiguration('docHelper');
  const docsDirectory = config.get<string>('saveDirectory') || 'docs/';

  // Command to open respective docs from code file or vice versa
  const openRespectiveDocs = vscode.commands.registerCommand('doc-helper-0711.openRespectiveDocs', async (uri?: vscode.Uri) => {
    // get active editor document URI
    const activeUri = uri ?? vscode.window.activeTextEditor?.document.uri;
    if (!activeUri) {
      vscode.window.showInformationMessage('No active file to open respective docs.');
      return;
    }
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders?.length) {
      vscode.window.showInformationMessage('Open a folder to use Doc Helper.');
      return;
    }
    const folder = workspaceFolders[0];
    const relPath = vscode.workspace.asRelativePath(activeUri, false).replace(/\\/g, '/');

    // code → docs
    if (/\.(ts|js|tsx|jsx)$/.test(relPath)) {
      const docRel = relPath
        .replace(/^src\//, docsDirectory)
        .replace(/\.(ts|js|tsx|jsx)$/, '.md');
      const docUri = vscode.Uri.joinPath(folder.uri, ...docRel.split('/'));
      try {
        await vscode.workspace.fs.stat(docUri);
        await vscode.window.showTextDocument(docUri, { viewColumn: vscode.ViewColumn.Beside, preview: false });
      } catch {
        const choice = await vscode.window.showInformationMessage(
          `Documentation not found: ${docRel}. Create a new one?`,
          'Generate AI Documentation', 'Cancel'
        );
        if (choice === 'Generate AI Documentation') {
          try {
            await generateDocumentation(activeUri);
            await vscode.window.showTextDocument(docUri, { viewColumn: vscode.ViewColumn.Beside, preview: false });
          } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to generate documentation: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }
    }
    // docs → code
    else if (/\.md$/.test(relPath)) {
      const base = relPath
        .replace(new RegExp('^' + docsDirectory.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'src/')
        .replace(/\.md$/, '');
      const exts = ['ts', 'js', 'tsx', 'jsx'];
      let found = false;
      for (const ext of exts) {
        const codeRel = `${base}.${ext}`;
        const codeUri = vscode.Uri.joinPath(folder.uri, ...codeRel.split('/'));
        try {
          await vscode.workspace.fs.stat(codeUri);
          await vscode.window.showTextDocument(codeUri, { viewColumn: vscode.ViewColumn.Beside, preview: false });
          found = true;
          break;
        } catch {
          // not found
        }
      }
      if (!found) {
        vscode.window.showWarningMessage(`Source file not found for documentation: ${relPath}`);
      }
    }
    // neither code nor docs
    else {
      vscode.window.showInformationMessage('Open a code or markdown file to use this command.');
    }
  });
  context.subscriptions.push(openRespectiveDocs);

  // Linking the code and docs function
  registerFileLinkingProviders(context);

  let inlineSuggestionDisposable: vscode.Disposable | undefined;
  const ghostEnabled = config.get<boolean>('enableGhostSuggestion', true);
  // Inline suggestion (ghost text) for doc writing
  if (ghostEnabled) {
    inlineSuggestionDisposable = registerInlineSuggestionProvider(context);
  }

  // Listen to configuration changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('docHelper.enableGhostSuggestion')) {
        const newConfig = vscode.workspace.getConfiguration('docHelper');
        const enabled = newConfig.get<boolean>('enableGhostSuggestion', true);
        if (enabled && !inlineSuggestionDisposable) {
          inlineSuggestionDisposable = registerInlineSuggestionProvider(context);
        } else if (!enabled && inlineSuggestionDisposable) {
          inlineSuggestionDisposable.dispose();
          inlineSuggestionDisposable = undefined;
        }
      }
    }),
    vscode.commands.registerCommand('doc-helper-0711.toggleGhostSuggestion', async () => {
      const config = vscode.workspace.getConfiguration('docHelper');
      const current = config.get<boolean>('enableGhostSuggestion', true);
      await config.update('enableGhostSuggestion', !current, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(`Ghost suggestion is now ${!current ? 'enabled' : 'disabled'}.`);
    })
  );

  // Register the missing doc code action provider
  registerMissingDocCodeActions(context);
  // Register the wrong numbering code action provider
  registerWrongNumberingCodeActions(context);

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

    const config = vscode.workspace.getConfiguration('docHelper');
    const docsDirectory = config.get<string>('saveDirectory') || 'docs/';

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
        .replace(/^src[\/\\]/, docsDirectory)
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
        .replace(new RegExp('^' + docsDirectory.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'src/')
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
        text = '$(alert) No Matched Source';
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

  // Add user report feedback here
  context.subscriptions.push(
    vscode.commands.registerCommand('doc-helper-0711.reportIssue', () => {
      vscode.env.openExternal(vscode.Uri.parse("https://github.com/skooi928/doc-helper-0711/issues/new"));
    })
  );
}

export function deactivate() {}