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
async function extractMarkdownSymbols(doc: vscode.TextDocument): Promise<vscode.DocumentSymbol[]> {
    const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
        'vscode.executeDocumentSymbolProvider', doc.uri
    );
    if (!symbols) {
        return [];
    }

    return flattenSymbols(symbols);
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

function getInsertionPositionForMissingSymbol(
  missingSymbol: vscode.DocumentSymbol,
  sourceSymbols: vscode.DocumentSymbol[],
  mdSymbols: vscode.DocumentSymbol[],
  doc: vscode.TextDocument
): vscode.Position {
  // Find the index of the missing symbol in the source symbols.
  const idx = sourceSymbols.findIndex(sym => sym.name.trim().toLowerCase().includes(missingSymbol.name.trim().toLowerCase()));
  // Look for the next symbol in the source symbols that has an equivalent markdown heading.
  for (let i = idx + 1; i < sourceSymbols.length; i++) {
    const nextSymbolName = sourceSymbols[i].name.trim().toLowerCase();
    // Use the markdown symbols from the provider (which may already be in order).
    const mdMatch = mdSymbols.find(mdSym => mdSym.name.trim().toLowerCase().includes(nextSymbolName));
    if (mdMatch) {
      // Return the position of the markdown symbol (usually the start of the heading).
      return mdMatch.range.start;
    }
  }

   // Find matched symbols
   const matchedSymbols = mdSymbols.filter(mdSym => {
     return sourceSymbols.some(sourceSym => (mdSym.name.trim().toLowerCase()).includes(sourceSym.name.trim().toLowerCase()));
   });
   const lastMdSymbol = matchedSymbols.length > 0 ? matchedSymbols[matchedSymbols.length - 1] : null;
   return lastMdSymbol ? lastMdSymbol.range.end : new vscode.Position(doc.lineCount, 0);
}

// Call this function to update diagnostics from the missing symbols
function updateDiagnostics(
  doc: vscode.TextDocument,
  missingSymbols: vscode.DocumentSymbol[],
  orderedSourceSymbols: vscode.DocumentSymbol[],
  mdSymbols: vscode.DocumentSymbol[]
) {
  const diagnostics: vscode.Diagnostic[] = missingSymbols.map(sym => {
    // Get the diagnostic position using our helper function; use a zero-length range at that position.
    const pos = getInsertionPositionForMissingSymbol(sym, orderedSourceSymbols, mdSymbols, doc);
    const lineRange = doc.lineAt(pos).range;
    const message = `Missing documentation for function '${sym.name}'`;
    // Create a diagnostic at the determined position.
    return new vscode.Diagnostic(
      lineRange,
      message,
      vscode.DiagnosticSeverity.Warning
    );
  });
  // Order diagnostics by their position in the document
  diagnostics.sort((a, b) => a.range.start.line - b.range.start.line || a.range.start.character - b.range.start.character);
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
    let userDefinedSymbols = [];
    for (const sym of allSymbols) {
      const isFromLibrary = await symFromLibrary(sym, sourceUri);
      if (!isFromLibrary) {
        userDefinedSymbols.push(sym);
      }
    }

    // Sort user-defined symbols by their order in the source file
    userDefinedSymbols = userDefinedSymbols.sort((a, b) => a.range.start.line - b.range.start.line);

    // Extract headings and sort from markdown using the symbol provider
    const mdSymbols = (await extractMarkdownSymbols(document)).sort((a, b) => a.range.start.line - b.range.start.line);
    
    // Find missing symbols (those whose name does not appear in any heading)
    const missingSymbols = userDefinedSymbols.filter(sym => {
      return !mdSymbols.some(mdSym => mdSym.name.trim().toLowerCase().includes(sym.name.trim().toLowerCase()));
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
    updateDiagnostics(document, missingSymbols, userDefinedSymbols, mdSymbols);

    const actions: vscode.CodeAction[] = [];

    // Filter diagnostics for missing documentation that intersect with the current range
    const relevantDiagnostics = context.diagnostics.filter(diag =>
      diag.message.startsWith("Missing documentation for function") &&
      diag.range.intersection(range)
    );

    // Create individual quick fixes for each relevant diagnostic
    relevantDiagnostics.forEach(diagnostic => {
      const insertOneAction = new vscode.CodeAction(
        "Insert missing documentation sections",
        vscode.CodeActionKind.QuickFix
      );
      
      // Link this specific diagnostic to the code action
      insertOneAction.diagnostics = [diagnostic];
      
      insertOneAction.command = {
        title: "Insert Missing Documentation",
        command: "doc-helper-0711.insertMissingDocs",
        arguments: [document.uri, [diagnostic]] // Pass the specific diagnostic
      };
      insertOneAction.isPreferred = true;
      actions.push(insertOneAction);
    });

    // Create a CodeAction to let the user insert missing documentation
    const insertAction = new vscode.CodeAction(
      "Insert ALL missing documentation sections",
      vscode.CodeActionKind.QuickFix
    );
    insertAction.command = {
      title: "Insert Missing Documentation",
      command: "doc-helper-0711.insertAllMissingDocs",
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

// Command to insert missing documentation for a single selected diagnostic
vscode.commands.registerCommand(
  "doc-helper-0711.insertMissingDocs",
  async (docUri: vscode.Uri, diagnostics: vscode.Diagnostic[]) => {
    const document = await vscode.workspace.openTextDocument(docUri);
    const editor = await vscode.window.showTextDocument(document);

    // Use the specific diagnostic passed from the quick fix
    if (!diagnostics || diagnostics.length === 0) {
      vscode.window.showInformationMessage("No diagnostic selected to fix.");
      return;
    }
    const diagToFix = diagnostics[0];

    // Parse the function name from the diagnostic message
    const regex = /Missing documentation for function '([^']+)'/;
    const match = diagToFix.message.match(regex);
    if (!match) {
      vscode.window.showErrorMessage("Could not parse function name from diagnostic.");
      return;
    }
    const funcName = match[1];

    // Find the corresponding source file
    const sourceUri = await findCorrespondingSourceFile(document.uri);
    if (!sourceUri) {
      vscode.window.showErrorMessage("No corresponding source file found.");
      return;
    }

    // Get source symbols and filter for user-declared symbols
    const srcSymbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
      "vscode.executeDocumentSymbolProvider",
      sourceUri
    ) || [];

    const rawSourceSymbols = flattenSymbols(srcSymbols).filter(sym =>
      sym.kind === vscode.SymbolKind.Function &&
      sym.name &&
      sym.name.trim() !== '' &&
      !sym.name.includes('callback') &&
      !sym.name.startsWith('(') &&
      !sym.name.startsWith('<')
    );

    // Filter out library symbols asynchronously
    let userDefinedSymbols: vscode.DocumentSymbol[] = [];
    for (const sym of rawSourceSymbols) {
      const isFromLibrary = await symFromLibrary(sym, sourceUri);
      if (!isFromLibrary) {
        userDefinedSymbols.push(sym);
      }
    }
    // Sort user-defined symbols by order in the source file
    userDefinedSymbols.sort((a, b) => a.range.start.line - b.range.start.line);

    // Find the missing symbol in the source file by matching the function name
    const missingSymbol = userDefinedSymbols.find(sym =>
      sym.name.trim().toLowerCase() === funcName.trim().toLowerCase()
    );
    if (!missingSymbol) {
      vscode.window.showErrorMessage(`Could not find matching function symbol for "${funcName}" in the source file.`);
      return;
    }

    // Extract markdown headings from the documentation file
    const mdSymbols = await extractMarkdownSymbols(document);

    // Compute the insertion position in the markdown file using the helper
    const insertPos = getInsertionPositionForMissingSymbol(missingSymbol, userDefinedSymbols, mdSymbols, document);

    // Determine header number based on the function's order in the source
    const missingIndex = userDefinedSymbols.findIndex(sym =>
      sym.name.trim().toLowerCase() === funcName.trim().toLowerCase()
    );
    const headerNumber = missingIndex >= 0 ? missingIndex + 1 : 1;

    // Build the documentation snippet
    const snippetText =
      `### ${headerNumber}. \`${funcName}()\`\n` +
      `- **Parameters**: \n` +
      `- **Return Value**: \n` +
      `- **Usage Example**:\n` +
      "  ```javascript\n" +
      `  ${funcName}();\n` +
      "  ```\n" +
      `- **Description**: Description for **${funcName}**.\n\n`;

    // Insert the snippet at the computed position
    await editor.edit(editBuilder => {
      editBuilder.insert(insertPos, snippetText);
    });

    vscode.window.showInformationMessage(`Inserted documentation for function "${funcName}".`);
  }
);

// Command to insert missing documentation sections
vscode.commands.registerCommand(
  "doc-helper-0711.insertAllMissingDocs",
  async (docUri: vscode.Uri, missingSymbols: vscode.DocumentSymbol[]) => {
    const document = await vscode.workspace.openTextDocument(docUri);
    const editor = await vscode.window.showTextDocument(document);
    
    // Sort the missing symbols by their order in the source file
    missingSymbols.sort((a, b) => a.range.start.line - b.range.start.line);

    // Get the corresponding source file and compute the ordered user-defined symbols.
    const sourceUri = await findCorrespondingSourceFile(document.uri);
    if (!sourceUri) {
      vscode.window.showErrorMessage("No corresponding source file found.");
      return;
    }
    const srcSymbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
      "vscode.executeDocumentSymbolProvider",
      sourceUri
    ) || [];

    const rawSourceSymbols = flattenSymbols(srcSymbols).filter(sym =>
      sym.kind === vscode.SymbolKind.Function &&
      sym.name &&
      sym.name.trim() !== '' &&
      !sym.name.includes('callback') &&
      !sym.name.startsWith('(') &&
      !sym.name.startsWith('<')
    );
    
    // Filter out library symbols asynchronously
    let orderedSourceSymbols = [];
    for (const sym of rawSourceSymbols) {
      const isFromLibrary = await symFromLibrary(sym, sourceUri);
      if (!isFromLibrary) {
        orderedSourceSymbols.push(sym);
      }
    }

    // Sort by source order
    orderedSourceSymbols.sort((a, b) => a.range.start.line - b.range.start.line);

    // Use the markdown symbol provider to extract documented symbols.
    const mdSymbols = await extractMarkdownSymbols(document);

    // Build an array of insertion objects.
    const insertions: { position: vscode.Position, snippet: string }[] = [];
    
    // Prepare the text snippet to insert (each missing symbol gets a header template)
    missingSymbols.forEach((sym) => {
      const symbolName = sym.name;

      // Find the index of the missing symbol in the ordered source symbols.
      const missingIndex = orderedSourceSymbols.findIndex(sourceSym =>
        sourceSym.name.trim().toLowerCase().includes(symbolName.trim().toLowerCase())
      );
      // Use missingIndex+1 in the header. If not found, default to a sequential number.
      const headerNumber = missingIndex >= 0 ? missingIndex + 1 : 1;

      const snippetText =
        `### ${headerNumber}. \`${symbolName}()\`\n` +
        `- **Parameters**: \n` +
        `- **Return Value**: \n` +
        `- **Usage Example**:\n` +
        "  ```javascript\n" +
        `  ${symbolName}();\n` +
        "  ```\n" +
        `- **Description**: Description for **${symbolName}**.\n\n`;
      
      // Determine the insertion position using the helper function
      const insertPos = getInsertionPositionForMissingSymbol(sym, orderedSourceSymbols, mdSymbols, document);
      insertions.push({ position: insertPos, snippet: snippetText });
    });

    // To avoid shifting positions as we insert, sort the insertions descending by document offset.
    // Meaning insert from the end of the document backwards.
    insertions.sort((a, b) => document.offsetAt(b.position) - document.offsetAt(a.position));
    
    await editor.edit(editBuilder => {
      insertions.forEach(insertion => {
        editBuilder.insert(insertion.position, insertion.snippet);
      });
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