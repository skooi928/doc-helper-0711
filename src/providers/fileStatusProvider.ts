import * as vscode from 'vscode';
import * as path from 'path';
import ignore from 'ignore';
import { getWorkspaceConfig } from '../utils/doch';

export type FileStatus = 'Undocumented' | 'Undocumented-md' | 'Out-of-Date' | 'Out-of-Date-md' | 'Documented' | 'Documented-md' | 'No Source' | 'Independent';

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
      const categories = [
        new FileStatusItem('Undocumented', undefined, undefined, undefined, undefined, vscode.TreeItemCollapsibleState.Collapsed),
        new FileStatusItem('Out-of-date', undefined, undefined, undefined, undefined, vscode.TreeItemCollapsibleState.Collapsed),
        new FileStatusItem('Documented', undefined, undefined, undefined, undefined, vscode.TreeItemCollapsibleState.Collapsed),
        new FileStatusItem('No Source', undefined, undefined, undefined, undefined, vscode.TreeItemCollapsibleState.Collapsed),
        new FileStatusItem('Independent Markdown', undefined, undefined, undefined, undefined, vscode.TreeItemCollapsibleState.Collapsed)
      ];

      // Set contextValue to 'category' for all parent items
      categories.forEach(item => item.contextValue = 'category');
      return categories;
    }

    const folders = vscode.workspace.workspaceFolders;
    if (!folders) {return [];}
    const root = folders[0].uri;
    const workspaceFolder = folders[0];

    // Get dynamic config
    const { extensions, regex, sourceDirectories } = await getWorkspaceConfig(workspaceFolder);
    
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

    // Ignore the files in .dochignore
    try {
      const dochignoreUri = vscode.Uri.joinPath(root, '.dochignore');
      const bytes = await vscode.workspace.fs.readFile(dochignoreUri);
      ig.add(Buffer.from(bytes).toString('utf8'));
    } catch {
      // no .dochignore, skip
    }

    // Get all relevant files
    const extPattern = extensions.length > 1 ? extensions.join(',') : extensions[0] || 'ts';
    const pattern = new vscode.RelativePattern(root, `**/*.{${extPattern},md}`);
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

    const config = vscode.workspace.getConfiguration('docHelper');
    const docsDirectory = config.get<string>('saveDirectory') || 'docs/';

    // For all files, determine their status using same logic as extension.ts
    for (const uri of uris) {
      const rel = vscode.workspace.asRelativePath(uri, false);
      let status: FileStatus = 'Undocumented';

      if (regex.test(rel)) {
        // Source file logic - matches extension.ts updateStatus exactly
        let docRel = '';
        for (const dir of sourceDirectories) {
          const regexDir = new RegExp('^' + dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/');
          if (regexDir.test(rel)) {
            docRel = rel
              .replace(regexDir, docsDirectory)
              .replace(regex, '.md');
          }
        }
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
          status = 'Undocumented';
        }
        else if (entry && commitTime !== undefined && ((commitTime < codeTime) || (commitTime < docTime))) {
          status = 'Out-of-Date';
        }
        else if (entry && entry.documented) {
          status = 'Documented';
        }
        else {
          status = 'Undocumented'; // "Docs Uncommitted" case
        }

      } else if (/\.md$/.test(rel)) {
        // Markdown file logic - matches extension.ts updateStatus exactly
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
                vscode.Uri.joinPath(root, ...candidate.split(/[\\/]/))
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
          // Check if this is under docs/ or completely independent
          if (rel.startsWith(docsDirectory)) {
            status = 'No Source'; // "No matched source"
          } else {
            status = 'Independent'; // Independent markdown
          }
        } else {
          const codeUri = vscode.Uri.joinPath(root, ...srcRel.split(/[\\/]/));
          const srcStat = await vscode.workspace.fs.stat(codeUri);
          const codeTime = Math.max(srcStat.ctime, srcStat.mtime);
          const docsStat = await vscode.workspace.fs.stat(uri);
          const docsTime = Math.max(docsStat.ctime, docsStat.mtime);
          const entry = state[srcRel];
          const commitTime = entry ? Date.parse(entry.timestamp) : undefined;

          if (entry && commitTime !== undefined && ((commitTime < codeTime) || (commitTime < docsTime))) {
            status = 'Out-of-Date-md'; // "Stale"
          }
          else if (entry && entry.documented) {
            status = 'Documented-md'; // "Sync"
          }
          else {
            status = 'Undocumented-md'; // "Uncommitted Docs"
          }
        }
      }

      // Only include items matching the current category
      if (
        (element.label === 'Undocumented' && status === 'Undocumented') ||
        (element.label === 'Undocumented' && status === 'Undocumented-md') ||
        (element.label === 'Out-of-date'  && status === 'Out-of-Date')   ||
        (element.label === 'Out-of-date'  && status === 'Out-of-Date-md') ||
        (element.label === 'Documented'   && status === 'Documented') ||
        (element.label === 'Documented'   && status === 'Documented-md') ||
        (element.label === 'No Source'    && status === 'No Source') ||
        (element.label === 'Independent Markdown' && status === 'Independent')
      ) {
        const name = path.basename(uri.fsPath);
        const cmd: vscode.Command = { 
          command: 'doc-helper-0711.openFile',
          title: 'Open File',
          arguments: [uri] 
        };

        items.push(new FileStatusItem(name, uri, status, uri.fsPath, cmd));
      }
    }
    // Sort items alphabetically
    items.sort((a, b) => a.label.localeCompare(b.label));
    return items;
  }

  // Flatten all categories and return every file item
  async getAllItems(): Promise<FileStatusItem[]> {
    const topCats = await this.getChildren();
    const all: FileStatusItem[] = [];
    for (const cat of topCats) {
      const children = await this.getChildren(cat);
      all.push(...children);
    }
    return all;
  }
}