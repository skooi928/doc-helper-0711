import * as vscode from 'vscode';

let globalContext: vscode.ExtensionContext;

// -----------------------------------
// HELPER FUNCTIONS
// -----------------------------------

// Create a Diagnostic Collection (can be done in your activate function)
// let ignore = false;}

const diagnosticCollection = vscode.languages.createDiagnosticCollection('docHelper');
// Function to retrieve ignored document URIs (stored as strings)
function getIgnoredDocs(context: vscode.ExtensionContext): string[] {
  return context.globalState.get<string[]>('ignoredDocs', []);
}

// Function to store an ignored document URI
async function addIgnoredDoc(context: vscode.ExtensionContext, docUri: vscode.Uri) {
  const ignoredDocs = getIgnoredDocs(context);
  const uriStr = docUri.toString();
  if (!ignoredDocs.includes(uriStr)) {
    ignoredDocs.push(uriStr);
    await context.globalState.update('ignoredDocs', ignoredDocs);
  }
}

// Function to check if a document is ignored
function isDocIgnored(context: vscode.ExtensionContext, docUri: vscode.Uri): boolean {
  const ignoredDocs = getIgnoredDocs(context);
  return ignoredDocs.includes(docUri.toString());
}

async function findCorrespondingSourceFile(docUri: vscode.Uri): Promise<vscode.Uri | undefined> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) {
    return undefined;
  }
  
  const folder = folders[0];
  const config = vscode.workspace.getConfiguration('docHelper');
  const docsDirectory = config.get<string>('saveDirectory') || 'docs/';
  const docRel = vscode.workspace.asRelativePath(docUri, false);
  
  // Convert docs path back to source path
  const base = docRel
    .replace(new RegExp('^' + docsDirectory.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'src/')
    .replace(/\.md$/, '');
  
  // Try to find the corresponding source file
  const exts = ['ts', 'tsx', 'js', 'jsx'];
  
  for (const ext of exts) {
    const candidate = `${base}.${ext}`;
    const candidateUri = vscode.Uri.joinPath(folder.uri, ...candidate.split(/[\\/]/));
    try {
      await vscode.workspace.fs.stat(candidateUri);
      return candidateUri;
    } catch {
      // not found, continue
    }
  }
  return undefined;
}

// Recursively flatten DocumentSymbols
function flattenSymbols(symbols: vscode.DocumentSymbol[]): vscode.DocumentSymbol[] {
  let result: vscode.DocumentSymbol[] = [];
  for (const sym of symbols) {
    result.push(sym);
    if (sym.children && sym.children.length > 0) {
      result.push(...flattenSymbols(sym.children));
    }
  }
  return result;
}

// Extract markdown symbols
async function extractMarkdownSymbols(doc: vscode.TextDocument): Promise<string[]> {
    const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
        'vscode.executeDocumentSymbolProvider', doc.uri
    );
    if (!symbols) {
        return [];
    }

    // Flatten and get the symbol names.
    const allSymbols = flattenSymbols(symbols);
    return allSymbols.map(sym => sym.name);
}

async function symFromLibrary(sym: vscode.DocumentSymbol, sourceUri: vscode.Uri): Promise<boolean> {
  try {
    const defs = await vscode.commands.executeCommand<vscode.Location[]>(
      'vscode.executeDefinitionProvider',
      sourceUri,
      sym.range.start
    );
    
    // (> 0), it's user-defined, so return false
    // (= 0), it's from library, so return true
    return !defs || defs.length === 0;
  } catch (error) {
    console.error(`Error getting definition for symbol ${sym.name}:`, error);
    // If there's an error, assume it's from library
    return true;
  }
}

// Call this function to update diagnostics from the missing symbols
function updateDiagnostics(doc: vscode.TextDocument, missingSymbols: vscode.DocumentSymbol[]) {
  const diagnostics: vscode.Diagnostic[] = missingSymbols.map(sym => {
    const message = `Missing documentation for function '${sym.name}'`;
    return new vscode.Diagnostic(
      sym.range,
      message,
      vscode.DiagnosticSeverity.Warning // or Error, Information, etc.
    );
  });
  diagnosticCollection.set(doc.uri, diagnostics);
}

// -----------------------------------
// CODE ACTION: MISSING DOCS DETECTION
// -----------------------------------

export class MissingDocCodeActionProvider implements vscode.CodeActionProvider {
  constructor(private context: vscode.ExtensionContext) {}

  async provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range,
    context: vscode.CodeActionContext,
    token: vscode.CancellationToken
  ): Promise<vscode.CodeAction[] | undefined> {
    // Only process markdown docs in our docs directory
    const docPath = vscode.workspace.asRelativePath(document.uri);
    const config = vscode.workspace.getConfiguration('docHelper');
    const docsDirectory = config.get<string>('saveDirectory') || 'docs/';
    if (!docPath.startsWith(docsDirectory) || !docPath.endsWith('.md')) {
      return;
    }
    
    // Find the corresponding source file
    const sourceUri = await findCorrespondingSourceFile(document.uri);
    if (!sourceUri) {
      return;
    }
    
    // Get source symbols and filter for user-declared symbols
    const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
      "vscode.executeDocumentSymbolProvider",
      sourceUri
    ) || [];
    const allSymbols = flattenSymbols(symbols).filter(sym =>
      sym.kind === vscode.SymbolKind.Function &&
      sym.name &&
      sym.name.trim() !== '' &&
      !sym.name.includes('callback') &&
      !sym.name.startsWith('(') &&
      !sym.name.startsWith('<')
    );

    // Filter out library symbols asynchronously
    const userDefinedSymbols = [];
    for (const sym of allSymbols) {
      const isFromLibrary = await symFromLibrary(sym, sourceUri);
      if (!isFromLibrary) {
        userDefinedSymbols.push(sym);
      }
    }

    // Extract headings from markdown using the symbol provider
    const mdSymbols = await extractMarkdownSymbols(document);
    
    // Find missing symbols (those whose name does not appear in any heading)
    const missingSymbols = userDefinedSymbols.filter(sym => {
      return !mdSymbols.some(mdSym => mdSym.trim().toLowerCase().includes(sym.name.trim().toLowerCase()));
    });

    // Check if this document is marked as ignored
    if (isDocIgnored(this.context, document.uri)) {
      diagnosticCollection.delete(document.uri);
      return;
    }
    
    if (missingSymbols.length === 0) {
      diagnosticCollection.delete(document.uri);
      return;
    }

    // Update diagnostics to show warnings for missing symbols
    updateDiagnostics(document, missingSymbols);

    const actions: vscode.CodeAction[] = [];
    
    // Create a CodeAction to let the user insert missing documentation
    const insertAction = new vscode.CodeAction(
      "Insert missing documentation sections",
      vscode.CodeActionKind.QuickFix
    );
    insertAction.command = {
      title: "Insert Missing Documentation",
      command: "doc-helper-0711.insertMissingDocs",
      arguments: [document.uri, missingSymbols]
    };
    insertAction.isPreferred = true;
    actions.push(insertAction);

    // Also add an ignore action so the user can choose to dismiss the warnings.
    const ignoreAction = new vscode.CodeAction(
      "Ignore missing documentation warnings",
      vscode.CodeActionKind.QuickFix
    );
    ignoreAction.command = {
      title: "Ignore missing documentation warnings",
      command: "doc-helper-0711.ignoreMissingDocs",
      arguments: [document.uri]
    };
    actions.push(ignoreAction);

    return actions;
  }
}

// Register the MissingDocCodeActionProvider for markdown files
export function registerMissingDocCodeActions(context: vscode.ExtensionContext): vscode.Disposable {
  globalContext = context;
  const provider = new MissingDocCodeActionProvider(context);
  const disposable = vscode.languages.registerCodeActionsProvider(
    { language: "markdown", scheme: "file" },
    provider,
    { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }
  );
  context.subscriptions.push(disposable);
  return disposable;
}

// Command to insert missing documentation sections
vscode.commands.registerCommand(
  "doc-helper-0711.insertMissingDocs",
  async (docUri: vscode.Uri, missingSymbols: vscode.DocumentSymbol[]) => {
    const document = await vscode.workspace.openTextDocument(docUri);
    const editor = await vscode.window.showTextDocument(document);
    
    // Sort the missing symbols by their order in the source file
    missingSymbols.sort((a, b) => a.range.start.line - b.range.start.line);
    
    // Prepare the text snippet to insert (each missing symbol gets a header template)
    let insertionText = "\n\n";
    missingSymbols.forEach((sym, index) => {
      const symbolName = sym.name;
      insertionText += `### ${index + 1}. \`${symbolName}()\`\n`;
      insertionText += `- **Parameters**: \n`;
      insertionText += `- **Return Value**: \n`;
      insertionText += `- **Usage Example**:\n`;
      insertionText += `- **Description**: Description for **${symbolName}**.\n\n`;
    });
    
    // Insert at the end of the document for now
    await editor.edit(editBuilder => {
      editBuilder.insert(new vscode.Position(document.lineCount, 0), insertionText);
    });
    
    vscode.window.showInformationMessage("Inserted missing documentation sections.");
  }
);

// Command to ignore missing documentation warnings by clearing the diagnostics.
vscode.commands.registerCommand("doc-helper-0711.ignoreMissingDocs", async (docUri: vscode.Uri) => {
  // Pop up a confirmation message with Yes/No options
  const result = await vscode.window.showWarningMessage(
    "Are you sure you want to ignore missing documentation warnings for this file?",
    {modal: true},
    "Yes",
    "No"
  );
  if (result !== "Yes") {
    return;
  }
  diagnosticCollection.delete(docUri);
  // ignore = true;
  await addIgnoredDoc(globalContext, docUri);
});