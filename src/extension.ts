import * as vscode from 'vscode';
import { initDochRepo, updateDochContext, watchDocState, getWorkspaceConfig, createConfigWatcher } from './utils/doch';
import { ChatbotViewProvider } from './providers/chatbotViewProvider'; 
import { FileStatusItem, FileStatusProvider } from './providers/fileStatusProvider';
import { registerFileLinkingProviders } from './providers/fileLinkingProvider';
import { TaskTreeProvider, TaskManager, SortMode } from './providers/taskTreeProvider';
import { registerMissingDocCodeActions } from './providers/missingDocCodeActionProvider';
import { registerWrongNumberingCodeActions } from './providers/wrongNumberingCodeActionProvider';
import { generateDocumentation, summarizeDocumentation, checkDocumentation, registerInlineSuggestionProvider, documentTypes, generateGeneralDocumentations } from './utils/simplifyWriting';
import { addTask, editTask, toggleSort } from './utils/todoTracker';

export async function activate(context: vscode.ExtensionContext) {
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

  createConfigWatcher(context, () => {
    updateStatus(vscode.window.activeTextEditor); // Refresh status when config changes
  });

  // Register task tracker provider and commands after the doch repo is initialized
  const taskManager = new TaskManager(context);
  const taskTreeProvider = new TaskTreeProvider(taskManager);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('doc-helper-tasks', taskTreeProvider),
    vscode.commands.registerCommand('doc-helper-0711.addTask', () => addTask(context, taskManager, taskTreeProvider)),
    vscode.commands.registerCommand('doc-helper-0711.toggleTask', async (taskId: string) => {
      const task = taskManager.toggleTask(taskId);
      if (task) {
          taskTreeProvider.refresh();
          const status = task.completed ? 'completed' : 'pending';
          vscode.window.showInformationMessage(`Task marked as ${status}`);
      }
    }),
    vscode.commands.registerCommand('doc-helper-0711.editTask', (taskTreeItem: any) => editTask(context, taskManager, taskTreeProvider, taskTreeItem)),
    vscode.commands.registerCommand('doc-helper-0711.deleteTask', async (taskTreeItem: any) => {
      const taskId = taskTreeItem.task.id;
      const task = taskManager.getTasks().find(t => t.id === taskId);
      
      if (!task) {
        return;
      }

      const confirmation = await vscode.window.showWarningMessage(
          `Delete task "${task.title}"?`,
          { modal: true },
          'Delete'
      );

      if (confirmation === 'Delete') {
          taskManager.deleteTask(taskId);
          taskTreeProvider.refresh();
          vscode.window.showInformationMessage('Task deleted successfully!');
      }
    }),
    vscode.commands.registerCommand('doc-helper-0711.jumpToTaskFile', async (taskTreeItem: any) => {
      const task = taskTreeItem.task;
      
      if (task.fileUri) {
        try {
          // Handle both file paths and URIs
          let uri: vscode.Uri;
          if (task.fileUri.startsWith('file://') || task.fileUri.includes('://')) {
            uri = vscode.Uri.parse(task.fileUri);
          } else {
            uri = vscode.Uri.file(task.fileUri);
          }
          
          const document = await vscode.workspace.openTextDocument(uri);
          const editor = await vscode.window.showTextDocument(document);
          
          if (task.lineNumber && task.lineNumber > 0) {
            const position = new vscode.Position(task.lineNumber - 1, 0);
            editor.selection = new vscode.Selection(position, position);
            editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
          }
        } catch (error) {
          vscode.window.showErrorMessage(`Could not open file: ${task.fileUri}`);
        }
      } else {
        vscode.window.showInformationMessage('This task is not linked to any file.');
      }
    }),
    vscode.commands.registerCommand('doc-helper-0711.sortTasksByPriority', () => {
      taskTreeProvider.setSortMode(SortMode.Priority);
      vscode.window.showInformationMessage('Tasks sorted by priority');
    }),
    vscode.commands.registerCommand('doc-helper-0711.sortTasksByCreation', () => {
      taskTreeProvider.setSortMode(SortMode.CreationOrder);
      vscode.window.showInformationMessage('Tasks sorted by creation order');
    }),
    vscode.commands.registerCommand('doc-helper-0711.sortTasksAlphabetically', () => {
      taskTreeProvider.setSortMode(SortMode.Alphabetical);
      vscode.window.showInformationMessage('Tasks sorted alphabetically');
    }),
    vscode.commands.registerCommand('doc-helper-0711.sortTasksByStatus', () => {
      taskTreeProvider.setSortMode(SortMode.Status);
      vscode.window.showInformationMessage('Tasks sorted by status');
    }),
    vscode.commands.registerCommand('doc-helper-0711.sortTasksByDeadline', () => {
      taskTreeProvider.setSortMode(SortMode.Deadline);
      vscode.window.showInformationMessage('Tasks sorted by deadline');
    }),
    vscode.commands.registerCommand('doc-helper-0711.toggleTaskSort', async () => toggleSort(taskTreeProvider))
  );

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
    vscode.commands.registerCommand('doc-helper-0711.generateGeneralDocs', async () => {
      const selection = await vscode.window.showQuickPick(documentTypes, {
        placeHolder: 'Select a documentation type to generate',
        matchOnDescription: true
      });

      if (!selection) {
        return;
      }

      await generateGeneralDocumentations(selection);
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
    vscode.commands.registerCommand('doc-helper-0711.refreshFileStatus', () => {
      fileStatusProvider.refresh();
      updateStatus(vscode.window.activeTextEditor);
    }),
    vscode.commands.registerCommand('doc-helper-0711.generateDoc', async (item: FileStatusItem) => {
      if (item.fileUri) {
        // TODO: Call your AI service to generate docs
        await generateDocumentation(item.fileUri);
      }
    }),
    vscode.commands.registerCommand('doc-helper-0711.generateDocFromSelection', async (item: FileStatusItem) => {
      const categories = await fileStatusProvider.getChildren();
      const undocumented = categories.find(cat => cat.label === 'Undocumented');
      if (!undocumented) {
        vscode.window.showInformationMessage('No undocumented files found.');
        return;
      }
      const items = await fileStatusProvider.getChildren(undocumented);
      const picks = await vscode.window.showQuickPick(
        items.map(item => ({ label: item.label, item })),
        { canPickMany: true, placeHolder: 'Select files to generate documentation for', matchOnDescription: true }
      );
      if (picks) {
        for (const p of picks) {
          await vscode.commands.executeCommand('doc-helper-0711.generateDoc', p.item);
        }
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
    vscode.commands.registerCommand('doc-helper-0711.checkSelectedDocIssues', async (item: FileStatusItem) => {
      const categories = await fileStatusProvider.getChildren();
      const relevantCats = ['Out-of-date', 'Documented'];
      const relevant = categories.filter(cat => relevantCats.includes(cat.label));
      if (!relevant.length) {
        vscode.window.showInformationMessage('No relevant documentation issues found.');
        return;
      }
      const allRelevantItems: FileStatusItem[] = [];
      for (const cat of relevant) {
        const children = await fileStatusProvider.getChildren(cat);
        allRelevantItems.push(...children);
      }
      const picks = await vscode.window.showQuickPick(
        allRelevantItems.map(item => ({ label: item.label, detail: `Status: ${item.status}`, item })),
        { canPickMany: true, placeHolder: 'Select files to check documentation issues for' }
      );
      if (picks) {
        for (const p of picks) {
          await vscode.commands.executeCommand('doc-helper-0711.checkDocIssue', p.item);
        }
      }
    }),
    vscode.commands.registerCommand('doc-helper-0711.openFile', (uri: vscode.Uri) => {
      vscode.window.showTextDocument(uri);
    })
  );

  // Refresh on any source/docs change
  const { extensions } = await getWorkspaceConfig(vscode.workspace.workspaceFolders?.[0]!);
  if (extensions) {
    const extPattern = extensions.length > 1 ? extensions.join(',') : extensions[0];
    const codeWatcher = vscode.workspace.createFileSystemWatcher(`**/*.{${extPattern},md}`);
    codeWatcher.onDidCreate(() => {fileStatusProvider.refresh(); updateStatus(vscode.window.activeTextEditor);});
    codeWatcher.onDidChange(() => {fileStatusProvider.refresh(); updateStatus(vscode.window.activeTextEditor);});
    codeWatcher.onDidDelete(() => {fileStatusProvider.refresh(); updateStatus(vscode.window.activeTextEditor);});
    context.subscriptions.push(codeWatcher);
  }

  // Refresh when config.yml changes
  const configymlWatcher = vscode.workspace.createFileSystemWatcher('**/.doch/config.yml');
  configymlWatcher.onDidCreate(() => fileStatusProvider.refresh());
  configymlWatcher.onDidChange(() => fileStatusProvider.refresh());
  configymlWatcher.onDidDelete(() => fileStatusProvider.refresh());
  context.subscriptions.push(configymlWatcher);

  // Refresh when doc-state.json changes
  const docStateWatcher = vscode.workspace.createFileSystemWatcher('**/.doch/metadata/doc-state.json');
  docStateWatcher.onDidCreate(() => fileStatusProvider.refresh());
  docStateWatcher.onDidChange(() => fileStatusProvider.refresh());
  docStateWatcher.onDidDelete(() => fileStatusProvider.refresh());
  context.subscriptions.push(docStateWatcher);

  // Refresh when .dochignore changes
  const dochIgnoreWatcher = vscode.workspace.createFileSystemWatcher('**/.dochignore');
  dochIgnoreWatcher.onDidCreate(() => {fileStatusProvider.refresh(); updateStatus(vscode.window.activeTextEditor);});
  dochIgnoreWatcher.onDidChange(() => {fileStatusProvider.refresh(); updateStatus(vscode.window.activeTextEditor);});
  dochIgnoreWatcher.onDidDelete(() => {fileStatusProvider.refresh(); updateStatus(vscode.window.activeTextEditor);});
  context.subscriptions.push(dochIgnoreWatcher);

  const config = vscode.workspace.getConfiguration('docHelper');

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

    const docsDirectory = config.get<string>('saveDirectory') || 'docs/';

    // Get language format from dynamic config
    const { extensions, regex, sourceDirectories } = await getWorkspaceConfig(folder);

    // code → docs
    if (regex.test(relPath)) {
      let docRel: string | undefined;
      for (const dir of sourceDirectories) {
        const regexDir = new RegExp('^' + dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/');
        if (regexDir.test(relPath)) {
          docRel = relPath
            .replace(regexDir, docsDirectory)
            .replace(regex, '.md');
          break;
        }
      }
      if (!docRel) {
        vscode.window.showWarningMessage('Could not determine documentation path from the current file.');
        return;
      }
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
      let found = false;

      for (const dir of sourceDirectories) {
        const base = relPath
          .replace(new RegExp('^' + docsDirectory.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${dir}/`)
          .replace(/\.md$/, '');

        for (const ext of extensions) {
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
        if (found) {
          break;
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

  // Register a status bar menu command and bind it to the status bar item
  let ghostSnoozeTimer: NodeJS.Timeout | undefined;
  // Snooze ghost suggestions command (also used by tooltip link)
  const snoozeCmd = vscode.commands.registerCommand('doc-helper-0711.snoozeGhost5m', async () => {
    const cfg = vscode.workspace.getConfiguration('docHelper');
    if (ghostSnoozeTimer) {
      clearTimeout(ghostSnoozeTimer);
    }
    await cfg.update('enableGhostSuggestion', false, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage('Ghost suggestions snoozed for 5 minutes.');
    ghostSnoozeTimer = setTimeout(async () => {
      await cfg.update('enableGhostSuggestion', true, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage('Ghost suggestions re-enabled.');
    }, 5 * 60 * 1000);
  });
  context.subscriptions.push(snoozeCmd);

  const statusBarMenuCmd = vscode.commands.registerCommand('doc-helper-0711.statusBarMenu', async () => {
    const cfg = vscode.workspace.getConfiguration('docHelper');
    const isGhostEnabled = cfg.get<boolean>('enableGhostSuggestion', true);
    const underlineLinks = cfg.get<boolean>('hyperlinkUnderline', false);

    const quickPick = vscode.window.createQuickPick<vscode.QuickPickItem & { key?: string }>();
    quickPick.canSelectMany = true;
    quickPick.title = 'Doc Helper Settings';
    quickPick.matchOnDetail = true;
    quickPick.items = [
      { label: 'Enable ghost suggestions', picked: isGhostEnabled, key: 'enableGhostSuggestion' },
      { label: 'Underline hyperlinks', picked: underlineLinks, key: 'hyperlinkUnderline' },
    ];
    quickPick.selectedItems = quickPick.items.filter(i => (i as any).key === 'enableGhostSuggestion' ? isGhostEnabled : (i as any).key === 'hyperlinkUnderline' ? underlineLinks : false);

    const selection = await new Promise<(vscode.QuickPickItem & { key?: string })[] | undefined>(resolve => {
      quickPick.onDidAccept(() => resolve(quickPick.selectedItems as any));
      quickPick.onDidHide(() => resolve(undefined));
      quickPick.show();
    });
    quickPick.dispose();
    if (!selection) {
      return;
    }

    const selectedKeys = new Set(selection.map(s => s.key).filter(Boolean) as string[]);

    // Apply toggles
    const wantGhost = selectedKeys.has('enableGhostSuggestion');
    const wantUnderline = selectedKeys.has('hyperlinkUnderline');
    if (wantGhost !== isGhostEnabled) {
      await cfg.update('enableGhostSuggestion', wantGhost, vscode.ConfigurationTarget.Global);
    }
    if (wantUnderline !== underlineLinks) {
      await cfg.update('hyperlinkUnderline', wantUnderline, vscode.ConfigurationTarget.Global);
    }
  });
  context.subscriptions.push(statusBarMenuCmd);

  // function to load json state from .doch/metadata/doc-state.json
  async function loadState(): Promise<Record<string, { documented: boolean; timestamp: string; status?: 'uptodate' | 'outdated' | 'nodocs' }>> {
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

    // Check if doch is initialized
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) {
      statusBarItem.hide();
      return;
    }
    
    const folder = folders[0];
    const dochFolder = vscode.Uri.joinPath(folder.uri, '.doch');
    
    try {
      await vscode.workspace.fs.stat(dochFolder);
    } catch {
      // .doch folder doesn't exist, hide status bar
      statusBarItem.hide();
      return;
    }

    const docsDirectory = config.get<string>('saveDirectory') || 'docs/';

    const uri = editor.document.uri;
    const rel = vscode.workspace.asRelativePath(uri, false);
    if (!folders?.length) { // Check for file but not inside the same workspace
      statusBarItem.hide();
      return;
    }
    const { extensions, regex, sourceDirectories } = await getWorkspaceConfig(folder);
    const state = await loadState();
    let text: string | undefined;
    let bg: vscode.ThemeColor | undefined;

    if (regex.test(rel)) {
      // code file, check doc exists?
      let docRel: string | undefined;
      for (const dir of sourceDirectories) {
        const regexDir = new RegExp('^' + dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/');
        if (regexDir.test(rel)) {
          docRel = rel
            .replace(regexDir, docsDirectory)
            .replace(regex, '.md');
            break;
        }
      }
      if (!docRel) {
        statusBarItem.hide();
        return;
      }
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
      const entry = state[rel];
      const commitTime = entry ? Date.parse(entry.timestamp) : undefined;

      if (!docExists) {
        text = '$(alert) Undocumented';
        bg = new vscode.ThemeColor('statusBarItem.errorBackground');
      }
      else if (entry && commitTime !== undefined && ((commitTime < codeTime) || entry.status === 'outdated')) {
        text = '$(alert) Stale';
        bg = new vscode.ThemeColor('statusBarItem.warningBackground');
      }
      else if (entry && entry.documented && entry.status === 'uptodate') {
        text = '$(check) Documented';
        bg = undefined;
      }
      else {
        text = '$(circle-outline) Docs Uncommitted';
        bg = new vscode.ThemeColor('statusBarItem.errorBackground');
      }
    } else if (/\.md$/.test(rel)) {
      // markdown file, try all source extensions
      let foundExt: string|undefined;
      let srcRel: string|undefined;

      for (const dir of sourceDirectories) {
        const base = rel
          .replace(new RegExp('^' + docsDirectory.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${dir}/`)
          .replace(/\.md$/, '');

        for (const ext of extensions) {
          const candidate = `${base}.${ext}`;
          try {
            await vscode.workspace.fs.stat(
              vscode.Uri.joinPath(folder.uri, ...candidate.split(/[\\/]/))
            );
            foundExt = ext;
            srcRel = candidate;
            break;
          } catch {
            // not found, keep looking
          }
        }
        if (foundExt && srcRel) {
          break;
        }
      }

      if (!foundExt || !srcRel) {
        // no matching source at all
        text = '$(alert) No Matched Source';
        bg  = new vscode.ThemeColor('statusBarItem.warningBackground');
      } else {
        const codeUri = vscode.Uri.joinPath(folder.uri, ...srcRel.split(/[\\/]/));
        const srcStat = await vscode.workspace.fs.stat(codeUri);
        const codeTime = Math.max(srcStat.ctime, srcStat.mtime);
        const docsStat = await vscode.workspace.fs.stat(uri);
        const docsTime = Math.max(docsStat.ctime, docsStat.mtime);
        const entry = state[srcRel];
        const commitTime = entry ? Date.parse(entry.timestamp) : undefined;

        if (entry && commitTime !== undefined && (entry.status === 'outdated')) {
          text = '$(alert) Stale';
          bg = new vscode.ThemeColor('statusBarItem.warningBackground');
        }
        else if (entry && entry.documented && entry.status === 'uptodate') {
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
      // Build rich markdown tooltip with quick actions
      const cfg = vscode.workspace.getConfiguration('docHelper');
      const ghostSuggestion = cfg.get<boolean>('enableGhostSuggestion');
      const currentStatusLabel = text.replace(/\$\([^)]+\)\s*/, '');
      const md = ghostSuggestion ? new vscode.MarkdownString(
        `**Doc Helper**  \\
        Status: ${currentStatusLabel ?? '—'}  \\
        File: \`${rel}\`
        \n` +
        `$(refresh) [Refresh](command:doc-helper-0711.refreshFileStatus)  |  ` +
        `$(bell-slash) [Snooze Suggestion for 5m](command:doc-helper-0711.snoozeGhost5m)  |  ` +
        `$(settings-gear) [Settings](command:workbench.action.openSettings?%5B%22DocHelper%22%5D)`
      ): new vscode.MarkdownString(
        `**Doc Helper**  \\
        Status: ${currentStatusLabel ?? '—'}  \\
        File: \`${rel}\`
        \n` +
        `$(refresh) [Refresh](command:doc-helper-0711.refreshFileStatus)  |  ` +
        `$(settings-gear) [Settings](command:workbench.action.openSettings?%5B%22DocHelper%22%5D)`
      );
      md.isTrusted = true;
      md.supportThemeIcons = true;
      statusBarItem.tooltip = md;
      statusBarItem.backgroundColor = bg;
      // only attach the status‐bar menu command for Markdown files
      if (editor.document.languageId === 'markdown') {
        statusBarItem.command = 'doc-helper-0711.statusBarMenu';
      } else {
        statusBarItem.command = undefined;
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
    vscode.window.onDidChangeActiveTextEditor(updateStatus),
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('docHelper.hyperlinkUnderline') || e.affectsConfiguration('docHelper.enableGhostSuggestion')) {
        updateStatus(vscode.window.activeTextEditor); 
      }
    })
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