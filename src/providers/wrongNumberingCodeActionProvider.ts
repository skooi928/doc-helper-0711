import * as vscode from 'vscode';

let workspaceContext: vscode.ExtensionContext;

// Create a Diagnostic Collection for numbering issues
const diagnosticCollection = vscode.languages.createDiagnosticCollection('docHelper');

// Interface for heading information
interface HeadingInfo {
  symbol: vscode.DocumentSymbol;
  level: number;
  number: number | null;
  text: string;
  line: number;
}

function getIgnoredNumbers(context: vscode.ExtensionContext, docUri: vscode.Uri): { number: number, level: number }[] {
  const all = context.workspaceState.get<Record<string, { number: number, level: number }[]>>('ignoredNumberingProblems', {});
  return all[docUri.toString()] || [];
}

async function addIgnoredNumber(
  context: vscode.ExtensionContext,
  docUri: vscode.Uri,
  num: number,
  level: number
) {
  const all = context.workspaceState.get<Record<string, { number: number, level: number }[]>>('ignoredNumberingProblems', {});
  const key = docUri.toString();
  const arr = all[key] || [];

  // Check if this number+level combination already exists
  const exists = arr.some(item => item.number === num && item.level === level);
  if (!exists) {
    arr.push({ number: num, level: level });
    all[key] = arr;
    await context.workspaceState.update('ignoredNumberingProblems', all);
  }
}

// Extract numbering from heading text
function extractNumberFromHeading(headingText: string): number | null {
  // 1) Remove any leading markdown header markers (e.g. "### ")
  const text = headingText.replace(/^#+\s*/, '').trim();
  // 2) Match a number at the very start, followed by '.', ')', or whitespace
  const match = text.match(/^(\d+)(?:[.)]\s*|\s+)/);
  return match ? parseInt(match[1], 10) : null;
}

// Analyze headings and find numbering issues
function analyzeNumberingSequence(headings: HeadingInfo[]): { missing: { number: number, level: number, line: number }[], duplicates: { number: number, lines: number }[] } {
  const issues = { missing: [] as { number: number, level: number, line: number }[], duplicates: [] as { number: number, lines: number }[] };

  if (headings.length === 0) {
    return issues;
  }
  
  // Group headings by level to handle different sections
  const headingsByLevel = new Map<number, HeadingInfo[]>();
  for (const heading of headings) {
    if (!headingsByLevel.has(heading.level)) {
      headingsByLevel.set(heading.level, []);
    }
    headingsByLevel.get(heading.level)!.push(heading);
  }

  // sort based on number of # instead of tree level
  const sortedHeadingsByLevel = new Map(
    [...headingsByLevel.entries()].sort((a, b) => a[0] - b[0])
  );
  
  // Analyze each level separately
  for (const [level, levelHeadings] of sortedHeadingsByLevel) {
    const numberedHeadings = levelHeadings.filter(h => h.number !== null);

    if (numberedHeadings.length < 2) {
      continue; // Need at least 2 numbered headings to check sequence
    }

    // Sort by line number to maintain document order
    numberedHeadings.sort((a, b) => a.line - b.line);
    
    // Check for duplicates

    let expectedNext = 1;
    let prevDiff = 0;
    
    for (let i = 0; i < numberedHeadings.length; i++) {
      const heading = numberedHeadings[i];
      const num = heading.number!;
      
      // Check if this number follows the expected sequence
      if (num === expectedNext) {
        // This is the expected next number, increment expected
        expectedNext++;
      } else if (num === 1) {
        // Restart sequence from 1 is always allowed
        expectedNext = 2;
      } else {
        // This number doesn't follow the rule
        // Check what kind of error it is
        
        if (num < expectedNext) {
          const diff = expectedNext - num;
          // This number already appeared in current sequence
          // We'll handle this in the duplicate detection below
          if (diff !== prevDiff) {
            for (let j = 1; j <= num-1; j++) {
              issues.missing.push({ number: j, level: level, line: heading.line });
            }
            prevDiff = diff - 1;
          }
          issues.duplicates.push({ number: num, lines: heading.line });
        } else {
          // This number is higher than expected - there are missing numbers
          issues.missing.push({ number: expectedNext, level: level, line: heading.line });
          expectedNext = num + 1;
        }
      }
    }
  }
  
  return issues;
}

// Extract heading information from document symbols
async function extractHeadingInfo(document: vscode.TextDocument): Promise<HeadingInfo[]> {
  const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
    'vscode.executeDocumentSymbolProvider', 
    document.uri
  );
  
  if (!symbols) {
    return [];
  }
  
  const headings: HeadingInfo[] = [];
  
  function processSymbol(symbol: vscode.DocumentSymbol) {
    // Check if this is a heading (usually SymbolKind.String or SymbolKind.Namespace for markdown)
    if (symbol.kind === vscode.SymbolKind.String || 
        symbol.kind === vscode.SymbolKind.Namespace ||
        symbol.kind === vscode.SymbolKind.Module) {

      const line = symbol.range.start.line;
      const raw = document.lineAt(line).text;

      // match the actual `### …` from 1 - 6 only on the line
      const m = raw.match(/^(#{1,6})\s+(.*)$/);
      const level = m ? m[1].length : 1;
      const text  = m ? m[2].trim() : symbol.name;
      
      const number = extractNumberFromHeading(text);
      headings.push({
        symbol,
        level,
        number,
        text,
        line
      });
    }
    
    // Process children recursively
    for (const child of symbol.children) {
      processSymbol(child);
    }
  }
  
  symbols.forEach(processSymbol);

  return headings.sort((a, b) => a.line - b.line);
}

// Update diagnostics for numbering issues
async function updateNumberingDiagnostics(document: vscode.TextDocument) {
  // Only process markdown files
  if (document.languageId !== 'markdown') {
    return;
  }
  
  const headings = await extractHeadingInfo(document);
  const issues = analyzeNumberingSequence(headings);
  const ignored = getIgnoredNumbers(workspaceContext, document.uri);
  
  const diagnostics: vscode.Diagnostic[] = [];
  
  // Create diagnostics for missing numbers
  for (const missingNum of issues.missing) {
    // Check if this specific number+level combination is ignored
    const isIgnored = ignored.some(item => 
      item.number === missingNum.number && item.level === missingNum.level
    );
    
    if (isIgnored) {
      continue; // Skip ignored numbers at this level
    }
    // Find the best position to show the diagnostic (after the previous number or before the next)
    const headingsWithNumbers = headings.filter(h => h.number !== null);
    let targetHeading: HeadingInfo | null = null;
    
    // Find heading that comes after the missing number
    for (const heading of headingsWithNumbers) {
      if (heading.line === missingNum.line && heading.level === missingNum.level) {
        targetHeading = heading;
        break;
      }
    }
    
    // If no heading found after missing number, use the last numbered heading
    if (!targetHeading && headingsWithNumbers.length > 0) {
      targetHeading = headingsWithNumbers[headingsWithNumbers.length - 1];
    }
    
    if (targetHeading) {
      const range = targetHeading.symbol.range;
      const message = `Missing number ${missingNum.number} in heading sequence (level ${missingNum.level})`;
      const d = new vscode.Diagnostic(
        range,
        message,
        vscode.DiagnosticSeverity.Warning
      );
      d.source = 'numberingChecker';
      diagnostics.push(d);
    }
  }
  
  // Create diagnostics for duplicate numbers
  for (const duplicate of issues.duplicates) {
    const heading = headings.find(h => h.line === duplicate.lines);
    if (heading) {
      // Check if this specific number+level combination is ignored
      const isIgnored = ignored.some(item => 
        item.number === duplicate.number && item.level === heading.level
      );
      
      if (isIgnored) {
        continue;
      }

      const range = heading.symbol.range;
      const message = `Duplicate number ${duplicate.number} in heading sequence (level ${heading.level})`;
      const d = new vscode.Diagnostic(
        range,
        message,
        vscode.DiagnosticSeverity.Warning
      );
      d.source = 'numberingChecker';
      diagnostics.push(d);
    }
  }
  
  diagnosticCollection.set(document.uri, diagnostics);
}

// Code Action Provider for numbering issues
export class WrongNumberingCodeActionProvider implements vscode.CodeActionProvider {
  constructor(private context: vscode.ExtensionContext) {}

  async provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range,
    context: vscode.CodeActionContext,
    token: vscode.CancellationToken
  ): Promise<vscode.CodeAction[] | undefined> {
    
    // Only process markdown files
    if (document.languageId !== 'markdown') {
      return;
    }

    // Update diagnostics before providing actions
    await updateNumberingDiagnostics(document);
    
    const actions: vscode.CodeAction[] = [];
    
    // Filter diagnostics for numbering issues that intersect with the current range
    const relevantDiagnostics = context.diagnostics.filter(diag =>
      diag.source === 'numberingChecker' &&
      (diag.message.includes("Missing number") || diag.message.includes("Duplicate number")) &&
      diag.range.intersection(range)
    );
    
    if (relevantDiagnostics.length === 0) {
      return actions;
    }
    
    // Create quick fixes for each diagnostic
    relevantDiagnostics.forEach(diagnostic => {
      if (diagnostic.message.includes("Missing number")) {
        const fixAction = new vscode.CodeAction(
          "Fix missing number in sequence",
          vscode.CodeActionKind.QuickFix
        );
        fixAction.diagnostics = [diagnostic];
        fixAction.command = {
          title: "Fix missing number",
          command: "doc-helper-0711.fixMissingNumber",
          arguments: [document.uri, diagnostic]
        };
        actions.push(fixAction);
      } else if (diagnostic.message.includes("Duplicate number")) {
        const fixAction = new vscode.CodeAction(
          "Fix duplicate number in sequence",
          vscode.CodeActionKind.QuickFix
        );
        fixAction.diagnostics = [diagnostic];
        fixAction.command = {
          title: "Fix duplicate number",
          command: "doc-helper-0711.fixDuplicateNumber",
          arguments: [document.uri, diagnostic]
        };
        actions.push(fixAction);
      }

      // Add action to renumber all headings
      const renumberAllAction = new vscode.CodeAction(
        "Renumber all same level headings in sequence",
        vscode.CodeActionKind.QuickFix
      );
      renumberAllAction.command = {
        title: "Renumber all headings",
        command: "doc-helper-0711.renumberAllHeadings",
        arguments: [document.uri, diagnostic]
      };
      actions.push(renumberAllAction);

      // ignore this numbering problem
      const ignore = new vscode.CodeAction(
        `Ignore this numbering problem`,
        vscode.CodeActionKind.QuickFix
      );
      ignore.diagnostics = [diagnostic];
      ignore.command = {
        title: 'Ignore numbering problem',
        command: 'doc-helper-0711.ignoreNumberingProblem',
        arguments: [document.uri, diagnostic]
      };
      actions.push(ignore);
    });
    
    return actions;
  }
}

// Register the provider and set up document change listeners
export function registerWrongNumberingCodeActions(context: vscode.ExtensionContext): vscode.Disposable {
  workspaceContext = context;
  const provider = new WrongNumberingCodeActionProvider(context);
  
  // Register the code action provider
  const disposable = vscode.languages.registerCodeActionsProvider(
    { language: "markdown", scheme: "file" },
    provider,
    { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }
  );

  const clearIgnoredOnChange = vscode.workspace.onDidSaveTextDocument(doc => {
    if (doc.languageId !== 'markdown') {
      return;
    }
    // load the full map
    const all = context.workspaceState.get<Record<string, number[]>>('ignoredNumberingProblems', {});
    // remove this URI’s key
    delete all[doc.uri.toString()];
    // write it back
    context.workspaceState.update('ignoredNumberingProblems', all);
  });
  
  context.subscriptions.push(
    disposable,
    clearIgnoredOnChange,
  );
  
  return disposable;
}

// Command to fix missing number
vscode.commands.registerCommand(
  "doc-helper-0711.fixMissingNumber",
  async (docUri: vscode.Uri, diagnostic: vscode.Diagnostic) => {
    const document = await vscode.workspace.openTextDocument(docUri);
    const editor = await vscode.window.showTextDocument(document);
    
    // Extract missing number from diagnostic message
    const match = diagnostic.message.match(/Missing number (\d+) in heading sequence \(level (\d+)\)/);
    if (!match) {
      return;
    }
    
    const missingNumber = parseInt(match[1], 10);
    const level = parseInt(match[2], 10);

    // Create heading with appropriate level
    const headingPrefix = '#'.repeat(level);
    
    // Insert a placeholder heading with the missing number
    const insertPos = diagnostic.range.start;
    const snippetText = `${headingPrefix} ${missingNumber}. [Missing Section]\n\n`;
    
    await editor.edit(editBuilder => {
      editBuilder.insert(insertPos, snippetText);
    });
    
    vscode.window.showInformationMessage(`Inserted placeholder for missing number ${missingNumber}`);
  }
);

// Command to fix duplicate number
vscode.commands.registerCommand(
  "doc-helper-0711.fixDuplicateNumber",
  async (docUri: vscode.Uri, diagnostic: vscode.Diagnostic) => {
    const document = await vscode.workspace.openTextDocument(docUri);
    const editor = await vscode.window.showTextDocument(document);

    // Extract level from diagnostic message
    const match = diagnostic.message.match(/Duplicate number (\d+) in heading sequence \(level (\d+)\)/);
    if (!match) {
      vscode.window.showErrorMessage("Could not parse duplicate number and level from diagnostic.");
      return;
    }
    const dupNumber = parseInt(match[1], 10);
    const level = parseInt(match[2], 10);

    // Get all headings at that level
    const headings = await extractHeadingInfo(document);
    const levelHeadings = headings
      .filter(h => h.number !== null && h.level === level)
      .sort((a, b) => a.line - b.line);

    if (levelHeadings.length === 0) {
      vscode.window.showInformationMessage(`No headings at level ${level} to renumber.`);
      return;
    }

    // Find the max existing number in that level
    const allNumbers = levelHeadings.map(h => h.number!);
    const maxNumber = Math.max(...allNumbers);
    const nextNumber = maxNumber + 1;

    // Replace the duplicate occurrence
    const lineIdx = diagnostic.range.start.line;
    const lineText = document.lineAt(lineIdx).text;
    // Only replace the first occurrence of the duplicate number on that line
    const newText = lineText.replace(
      new RegExp(`\\b${dupNumber}\\b`),
      nextNumber.toString()
    );

    await editor.edit(editBuilder => {
      editBuilder.replace(
        new vscode.Range(lineIdx, 0, lineIdx, lineText.length),
        newText
      );
    });

    vscode.window.showInformationMessage(
      `Replaced duplicate number ${dupNumber} with ${nextNumber} on level ${level}`
    );
  }
);

// Command to renumber all headings
vscode.commands.registerCommand(
  "doc-helper-0711.renumberAllHeadings",
  async (docUri: vscode.Uri, diagnostic: vscode.Diagnostic) => {
    const document = await vscode.workspace.openTextDocument(docUri);
    const editor = await vscode.window.showTextDocument(document);

    // Extract level from diagnostic message
    const match = diagnostic.message.match(/(?:Missing|Duplicate) number (\d+) in heading sequence \(level (\d+)\)/);
    if (!match) {
      vscode.window.showErrorMessage("Could not parse level from diagnostic message.");
      return;
    }

    const level = parseInt(match[2], 10);
    
    const headings = await extractHeadingInfo(document);
    const numberedHeadings = headings.filter(h => h.number !== null && h.level === level);
    
    if (numberedHeadings.length === 0) {
      vscode.window.showInformationMessage(`No numbered headings found at level ${level} to renumber.`);
      return;
    }

    numberedHeadings.sort((a, b) => a.line - b.line);
    
    await editor.edit(editBuilder => {
      // Renumber sequentially starting from 1 for this specific level
      numberedHeadings.forEach((heading, index) => {
        const newNumber = index + 1;
        const line = document.lineAt(heading.line);
        const newText = line.text.replace(/\d+/, newNumber.toString());
        editBuilder.replace(line.range, newText);
      });
    });
    
    vscode.window.showInformationMessage(
      `Renumbered ${numberedHeadings.length} headings at level ${level}.`
    );
  }
);

vscode.commands.registerCommand(
  'doc-helper-0711.ignoreNumberingProblem',
  async (docUri: vscode.Uri, diagnostic: vscode.Diagnostic) => {
    const doc = await vscode.workspace.openTextDocument(docUri);
    // parse the number from the diagnostic message
    const match = diagnostic.message.match(/(?:Missing|Duplicate) number (\d+) in heading sequence \(level (\d+)\)/);
    if (!match) {
      vscode.window.showErrorMessage("Could not parse heading number from diagnostic.");
      return;
    }
    const num = parseInt(match[1], 10);
    const level = parseInt(match[2], 10);
    await addIgnoredNumber(workspaceContext, docUri, num, level);
  }
);