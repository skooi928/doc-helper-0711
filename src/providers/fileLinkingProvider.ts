import { on } from 'events';
import * as vscode from 'vscode';

export function registerFileLinkingProviders(context: vscode.ExtensionContext) {
    // Decoration type to remove underlines from all links
  const noLinkUnderline = vscode.window.createTextEditorDecorationType({
    textDecoration: 'none'
  });

  const config = vscode.workspace.getConfiguration('docHelper');
  // toggle state for link underlines
  let linksHidden = !(config.get<boolean>('hyperlinkUnderline'));

  // hide all link underlines in the given Markdown editor
  async function hideUnderlines(editor?: vscode.TextEditor) {
    editor = editor || vscode.window.activeTextEditor!;
    if (!editor || editor.document.languageId !== 'markdown') {
      return;
    }
    const links = await vscode.commands.executeCommand<vscode.DocumentLink[]>(
      'vscode.executeLinkProvider',
      editor.document.uri
    );
    const ranges = (links || []).map(link => link.range);
    editor.setDecorations(noLinkUnderline, ranges);
  }

  // show underlines again by clearing our decoration
  function showUnderlines(editor?: vscode.TextEditor) {
    editor = editor || vscode.window.activeTextEditor!;
    if (!editor || editor.document.languageId !== 'markdown') {
      return;
    }
    editor.setDecorations(noLinkUnderline, []);
  }

  // Link provider for Markdown to code symbols
  class MarkdownSymbolLinkProvider implements vscode.DocumentLinkProvider {
    async provideDocumentLinks(doc: vscode.TextDocument): Promise<vscode.DocumentLink[]> {
      const text = doc.getText();
      const links: vscode.DocumentLink[] = [];

      const docsDirectory = config.get<string>('saveDirectory', 'docs/');

      const docPath = vscode.workspace.asRelativePath(doc.uri);
      // Only process saveDirectory/*.md files
      if (!docPath.startsWith(docsDirectory) || !docPath.endsWith('.md')) {
        return links;
      }

      const workspaceFolder = vscode.workspace.getWorkspaceFolder(doc.uri);
      if (!workspaceFolder) {
        return links;
      }

      // Get corresponding source file path
      const sourceBase = docPath
        .replace(new RegExp('^' + docsDirectory.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'src/')
        .replace(/\.md$/, '');

      // Try to find the corresponding source file
      const sourceExts = ['ts', 'tsx', 'js', 'jsx'];
      let sourceUri: vscode.Uri | undefined;
      
      for (const ext of sourceExts) {
        const candidateUri = vscode.Uri.joinPath(workspaceFolder.uri, `${sourceBase}.${ext}`);
        try {
          await vscode.workspace.fs.stat(candidateUri);
          sourceUri = candidateUri;
          break;
        } catch {
          // File doesn't exist
        }
      }

      if (!sourceUri) {
        return links;
      }

      try {
        // Get symbols from the corresponding source file
        const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
          'vscode.executeDocumentSymbolProvider',
          sourceUri
        ) || [];

        // Recursively extract all symbols (just top-level for now)
        const flattenSymbols = (syms: vscode.DocumentSymbol[]): vscode.DocumentSymbol[] => {
          const result: vscode.DocumentSymbol[] = [];
          for (const sym of syms) {
            result.push(sym);
            // if (sym.children) {
            //   // recursively flatten children
            //   result.push(...flattenSymbols(sym.children));
            // }
          }
          return result;
        };

        const allSymbols = flattenSymbols(symbols);

        // Create links for functions and classes
        for (const sym of allSymbols) {
          if (sym.kind === vscode.SymbolKind.Function
              // sym.kind === vscode.SymbolKind.Class ||
              // sym.kind === vscode.SymbolKind.Method ||
              // sym.kind === vscode.SymbolKind.Interface
              // sym.kind === vscode.SymbolKind.Variable || (Variable can be too common)
            ) {
            
            // Escape special regex characters in symbol name
            const escapedName = sym.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(`\\b${escapedName}\\b`, 'g');
            
            let match: RegExpExecArray | null;
            while ((match = regex.exec(text))) {
              const start = doc.positionAt(match.index);
              const end = doc.positionAt(match.index + sym.name.length);
              const range = new vscode.Range(start, end);
              
              // Create a URI that will open the file at the specific line
              const targetUri = sourceUri.with({
                fragment: `L${sym.range.start.line + 1}`
              });
              
              links.push(new vscode.DocumentLink(range, targetUri));
            }
          }
        }
        if (linksHidden) {
          // If links are currently hidden, apply the no-underline decoration
          const editor = vscode.window.visibleTextEditors.find(e => e.document === doc);
          const ranges = (links || []).map(symbols => symbols.range);
          if (editor){
            editor.setDecorations(noLinkUnderline, ranges);
          }
        } else {
          // Clear any existing decorations
          const editor = vscode.window.visibleTextEditors.find(e => e.document === doc);
          if (editor) {
            editor.setDecorations(noLinkUnderline, []);
          }
        }
      } catch (error) {
        console.error('Error getting symbols for', sourceUri.toString(), error);
      }
      return links;
    }

    resolveDocumentLink(link: vscode.DocumentLink): vscode.DocumentLink {
      return link;
    }
  }

  // Register the link provider only for markdown files
  context.subscriptions.push(
    vscode.languages.registerDocumentLinkProvider(
      { language: 'markdown', scheme: 'file' },
      new MarkdownSymbolLinkProvider()
    )
  );

  // register the toggleLink command
  context.subscriptions.push(
    vscode.commands.registerCommand('doc-helper-0711.toggleLink', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== 'markdown') {
        return;
      }
      config.update('hyperlinkUnderline', linksHidden, vscode.ConfigurationTarget.Global);
    })
  );

  // listen to configuration changes
  vscode.workspace.onDidChangeConfiguration(e => {
    if (e.affectsConfiguration("docHelper.hyperlinkUnderline")) {
        const config = vscode.workspace.getConfiguration('docHelper');
        linksHidden = !(config.get<boolean>('hyperlinkUnderline'));

        const editor = vscode.window.activeTextEditor;
        if (editor && editor.document.languageId === 'markdown') {
            if (linksHidden) {
                hideUnderlines(editor);
            } else {
                showUnderlines(editor);
            }
        }
    }
});
}