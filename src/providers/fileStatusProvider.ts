import * as vscode from 'vscode';
import * as path from 'path';
import ignore from 'ignore';

export type FileStatus = 'undocumented' | 'outOfDate' | 'documented' | 'noSource' | 'independent';

export class FileStatusItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly fileUri?: vscode.Uri,
    public readonly status?: FileStatus,
    public readonly tooltip?: string,
    public readonly command?: vscode.Command,
    collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None
  ) {
    super(label, fileUri ? vscode.TreeItemCollapsibleState.None : collapsibleState);
    this.resourceUri = fileUri;
    this.contextValue = status ?? label.toLowerCase();
    this.tooltip = tooltip;
    if (command) {
      this.command = command;
    }
  }
}

export class FileStatusProvider implements vscode.TreeDataProvider<FileStatusItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<FileStatusItem | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private context: vscode.ExtensionContext) {}

  refresh() {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: FileStatusItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: FileStatusItem): Promise<FileStatusItem[]> {
    if (!element) {
      // top-level categories
      return [
        new FileStatusItem('Undocumented', undefined, undefined, undefined, undefined, vscode.TreeItemCollapsibleState.Collapsed),
        new FileStatusItem('Out-of-date', undefined, undefined, undefined, undefined, vscode.TreeItemCollapsibleState.Collapsed),
        new FileStatusItem('Documented', undefined, undefined, undefined, undefined, vscode.TreeItemCollapsibleState.Collapsed),
        new FileStatusItem('No Source', undefined, undefined, undefined, undefined, vscode.TreeItemCollapsibleState.Collapsed),
        new FileStatusItem('Independent Markdown', undefined, undefined, undefined, undefined, vscode.TreeItemCollapsibleState.Collapsed)
      ];
    }

    const folders = vscode.workspace.workspaceFolders;
    if (!folders) {return [];}
    const root = folders[0].uri;
    
    // Load .doch metadata state - same as extension.ts loadState()
    async function loadState(): Promise<Record<string, { documented: boolean; timestamp: string }>> {
      const stateUri = vscode.Uri.joinPath(root, '.doch', 'metadata', 'doc-state.json');
      try {
        const buf = await vscode.workspace.fs.readFile(stateUri);
        return JSON.parse(buf.toString());
      } catch {
        return {};
      }
    }

    // Ignore the files in gitignore
    let ig = ignore();
    try {
      const gitignoreUri = vscode.Uri.joinPath(root, '.gitignore');
      const bytes = await vscode.workspace.fs.readFile(gitignoreUri);
      const content = Buffer.from(bytes).toString('utf8');
      ig.add(content);
    } catch {
      // no .gitignore, skip
    }

    // Get all relevant files
    const pattern = new vscode.RelativePattern(root, '**/*.{ts,tsx,js,jsx,md}');
    let uris = await vscode.workspace.findFiles(pattern);

    // Filter out ignored files
    if (ig) {
      uris = uris.filter(uri => {
        const rel = path.relative(root.fsPath, uri.fsPath).replace(/\\/g, '/');
        return !ig!.ignores(rel);
      });
    }

    const state = await loadState();
    const items: FileStatusItem[] = [];

    // For all files, determine their status using same logic as extension.ts
    for (const uri of uris) {
      const rel = vscode.workspace.asRelativePath(uri, false);
      let status: FileStatus = 'undocumented';

      if (/\.(ts|js|tsx)$/.test(rel)) {
        // Source file logic - matches extension.ts updateStatus exactly
        const docRel = rel
          .replace(/^src[\/\\]/, 'docs/')
          .replace(/\.(ts|js|tsx)$/, '.md');
        const docUri = vscode.Uri.joinPath(root, ...docRel.split(/[\\/]/));
        
        let docExists = false;
        try {
          await vscode.workspace.fs.stat(docUri);
          docExists = true;
        } catch {
          // not found
        }

        const codeUri = vscode.Uri.joinPath(root, ...rel.split(/[\\/]/));
        const codeStat = await vscode.workspace.fs.stat(codeUri);
        const codeTime = Math.max(codeStat.ctime, codeStat.mtime);
        const docStat = docExists ? await vscode.workspace.fs.stat(docUri) : undefined;
        const docTime = docStat ? Math.max(docStat.ctime, docStat.mtime) : 0;
        const entry = state[rel];
        const commitTime = entry ? Date.parse(entry.timestamp) : undefined;

        if (!docExists) {
          status = 'undocumented';
        }
        else if (entry && commitTime !== undefined && ((commitTime < codeTime) || (commitTime < docTime))) {
          status = 'outOfDate';
        }
        else if (entry && entry.documented) {
          status = 'documented';
        }
        else {
          status = 'undocumented'; // "Docs Uncommitted" case
        }

      } else if (/\.md$/.test(rel)) {
        // Markdown file logic - matches extension.ts updateStatus exactly
        const base = rel
          .replace(/^docs[\/\\]/, 'src/')
          .replace(/\.md$/, '');

        const exts = ['ts', 'js', 'tsx'];
        let foundExt: string|undefined;
        for (const ext of exts) {
          const candidate = `${base}.${ext}`;
          try {
            await vscode.workspace.fs.stat(
              vscode.Uri.joinPath(root, ...candidate.split(/[\\/]/))
            );
            foundExt = ext;
            break;
          } catch {
            // not found, keep looking
          }
        }

        if (!foundExt) {
          // Check if this is under docs/ or completely independent
          if (rel.startsWith('docs/')) {
            status = 'noSource'; // "No matched source"
          } else {
            status = 'independent'; // Independent markdown
          }
        } else {
          const srcRel = `${base}.${foundExt}`;
          const codeUri = vscode.Uri.joinPath(root, ...srcRel.split(/[\\/]/));
          const srcStat = await vscode.workspace.fs.stat(codeUri);
          const codeTime = Math.max(srcStat.ctime, srcStat.mtime);
          const docsStat = await vscode.workspace.fs.stat(uri);
          const docsTime = Math.max(docsStat.ctime, docsStat.mtime);
          const entry = state[srcRel];
          const commitTime = entry ? Date.parse(entry.timestamp) : undefined;

          if (entry && commitTime !== undefined && ((commitTime < codeTime) || (commitTime < docsTime))) {
            status = 'outOfDate'; // "Stale"
          }
          else if (entry && entry.documented) {
            status = 'documented'; // "Sync"
          }
          else {
            status = 'undocumented'; // "Uncommitted Docs"
          }
        }
      }

      // Only include items matching the current category
      if (
        (element.label === 'Undocumented' && status === 'undocumented') ||
        (element.label === 'Out-of-date'  && status === 'outOfDate')   ||
        (element.label === 'Documented'   && status === 'documented') ||
        (element.label === 'No Source'    && status === 'noSource') ||
        (element.label === 'Independent Markdown' && status === 'independent')
      ) {
        const name = path.basename(uri.fsPath);
        const cmd: vscode.Command =
          status === 'undocumented'
            ? { command: 'doc-helper-0711.generateDoc', title: 'Generate Doc', arguments: [uri] }
            : { command: 'doc-helper-0711.openFile',     title: 'Open File',     arguments: [uri] };

        items.push(new FileStatusItem(name, uri, status, uri.fsPath, cmd));
      }
    }

    return items;
  }
}