import * as vscode from 'vscode';
import * as path from 'path';
import { AIService } from '../ai/temporaryAI';
const aiService = new AIService();
import { DocumentationInlineSuggestionProvider } from '../providers/documentInlineSuggestionProvider';

export async function generateCommentAndInsert(fileUri?: vscode.Uri) {
  let document: vscode.TextDocument;
  let editor: vscode.TextEditor;
  if (fileUri) {
    document = await vscode.workspace.openTextDocument(fileUri);
    editor = await vscode.window.showTextDocument(document);
  } 
  else {
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
      vscode.window.showInformationMessage('No active editor found.');
      return;
    }
    editor = activeEditor;
    document = editor.document;
  }

  const ext = path.extname(document.fileName).toLowerCase();
  const language = ext === '.ts' || ext === '.tsx' ? 'typescript' : 'javascript';

  let selection = editor.selection;
  let codeToProcess: string;
  let range: vscode.Range;

  if (selection.isEmpty) {
    // Whole file
    range = new vscode.Range(
      new vscode.Position(0, 0),
      new vscode.Position(document.lineCount, 0)
    );
    codeToProcess = document.getText(range);
  } else {
    // Only selection
    range = selection;
    codeToProcess = document.getText(selection);
  }

  let commentedCode: string | undefined;
  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: 'Generate comments',
    cancellable: false
  }, async (progress) => {
    progress.report({ message: 'Analyzing code...' });
    const prompt = `You are an assistant that generates concise inline comments for the following ${language} code. 
    Only explain tricky, non-obvious, or important logic.
    Do not restate what the code already says.
    Do not mention the programming language or add formatting markers.
    Focus on reasoning or intention, not step-by-step narration.
    Keep comments short, clear, and professional.
    If a line needs no comment, skip it entirely.
    Return the ENTIRE code with comments inserted directly, as plain text only, ensuring no code is missing.

    Code:
    ${codeToProcess}`;
    commentedCode = await aiService.generateComment(prompt, language);
  });

  if (!commentedCode || commentedCode.trim().length === 0) {
    vscode.window.showInformationMessage('No comments generated.');
    return;
  }

  // Clean possible code fences
  let cleanedCode = commentedCode
    .replace(/```[\s\S]*?\n/, '')
    .replace(/```/g, '')
    .trim();

  // Write AI result to a temp file
  const tempFilePath = editor.document.uri.fsPath + '.ai-comment';
  const tempFileUri = vscode.Uri.file(tempFilePath);
  await vscode.workspace.fs.writeFile(tempFileUri, Buffer.from(cleanedCode, 'utf8'));

  let leftUri: vscode.Uri;
  let rightUri: vscode.Uri;
  let diffTitle: string;
  if (selection.isEmpty) {
    // Whole file: diff original file vs AI file
    leftUri = editor.document.uri;
    rightUri = tempFileUri;
    diffTitle = 'Review: Original vs AI-Commented (Whole File)';
  } else {
    // Selection: create temp file for selected block
    const selectedBlockPath = editor.document.uri.fsPath + '.selected-block';
    const selectedBlockUri = vscode.Uri.file(selectedBlockPath);
    await vscode.workspace.fs.writeFile(selectedBlockUri, Buffer.from(codeToProcess, 'utf8'));
    leftUri = selectedBlockUri;
    rightUri = tempFileUri;
    diffTitle = 'Review: Original vs AI-Commented (Selection)';
  }
  await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, diffTitle);

  const choice = await vscode.window.showInformationMessage(
    'Do you want to accept the AI-generated comments?',
    'Accept',
    'Reject'
  );

  let selectedBlockUri: vscode.Uri | undefined;
  if (!selection.isEmpty) {
    selectedBlockUri = vscode.Uri.file(editor.document.uri.fsPath + '.selected-block');
  }
  if (choice === 'Accept') {
    if (selection.isEmpty) {
      // Replace entire file
      await vscode.workspace.fs.writeFile(editor.document.uri, Buffer.from(cleanedCode, 'utf8'));
      vscode.window.showInformationMessage('AI comments inserted for whole file');
    } else {
      // Replace only the selected block in the original file
      const document = editor.document;
      const edit = new vscode.WorkspaceEdit();
      edit.replace(document.uri, range, cleanedCode);
      const success = await vscode.workspace.applyEdit(edit);
      if (success) {
        vscode.window.showInformationMessage('AI comments inserted for selection');
      } else {
        vscode.window.showErrorMessage('Failed to insert AI comments for selection.');
      }
    }
  } else {
    vscode.window.showInformationMessage('No changes applied.');
  }
  // Cleanup temp files
  try {
    await vscode.workspace.fs.delete(tempFileUri);
  } catch {}
  if (selectedBlockUri) {
    try {
      await vscode.workspace.fs.delete(selectedBlockUri);
    } catch {}
  }
}


// Summarize all documented markdown files and show a merge conflict editor view for README.md
export async function summarizeAllDocsWithReview(context: vscode.ExtensionContext) {
  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: "Doc Helper",
    cancellable: false
  }, async (progress) => {
    progress.report({ message: "Scanning documented markdown files..." });
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) {
      vscode.window.showErrorMessage('No workspace folder found');
      return;
    }
    const root = folders[0].uri;
    // Get only Documented-md files from the tree provider
    const fileStatusProvider = new (require('../providers/fileStatusProvider').FileStatusProvider)(context);
    const allItems: Array<{ status: string; fileUri?: vscode.Uri; fsPath?: string }> = await fileStatusProvider.getAllItems();
    const documentedMdItems = allItems.filter((item: { status: string; fileUri?: vscode.Uri }) => item.status === 'Documented-md' && item.fileUri && !/README\.md$/i.test(item.fileUri.fsPath));
    if (documentedMdItems.length === 0) {
      vscode.window.showInformationMessage('No documented markdown files found to summarize.');
      return;
    }
    progress.report({ message: "Reading documented files..." });
    // Read all documented md files
    const docs = await Promise.all(documentedMdItems.map(async (item) => {
      if (!item.fileUri) { return ''; }
      const buf = await vscode.workspace.fs.readFile(item.fileUri);
      return Buffer.from(buf).toString('utf8');
    }));
    progress.report({ message: "Generating summary with AI..." });
    // Use AI to summarize
    const summary = await aiService.summarizeDocumentation(docs.join('\n\n'));
    // Prepare README update
    const readmeUri = vscode.Uri.joinPath(root, 'README.md');
    let readmeContent = '';
    try {
      readmeContent = Buffer.from(await vscode.workspace.fs.readFile(readmeUri)).toString('utf8');
    } catch {
      // README.md does not exist, will create new
    }
    // Insert or update summary section
    const summarySectionHeader = '## Documentation Summary';
    const summaryBlock = `${summarySectionHeader}\n\n${summary}\n`;
    let newReadmeContent;
    const summaryHeaderIndex = readmeContent.indexOf(summarySectionHeader);
    if (summaryHeaderIndex !== -1) {
      // Replace everything below the summary header with the new summary block
      newReadmeContent = readmeContent.slice(0, summaryHeaderIndex) + summaryBlock;
    } else {
      // If no summary section, add at the top (after first header if present)
      const firstHeaderMatch = readmeContent.match(/^# .*/m);
      if (firstHeaderMatch) {
        const insertPos = firstHeaderMatch.index! + firstHeaderMatch[0].length;
        newReadmeContent =
          readmeContent.slice(0, insertPos) +
          '\n\n' + summaryBlock + '\n' +
          readmeContent.slice(insertPos);
      } else {
        newReadmeContent = summaryBlock + '\n' + readmeContent;
      }
    }
    // Create a temp file for the AI-generated README
    const tempReadmePath = readmeUri.fsPath + '.AI';
    const tempReadmeUri = vscode.Uri.file(tempReadmePath);
    await vscode.workspace.fs.writeFile(tempReadmeUri, Buffer.from(newReadmeContent, 'utf8'));
    // Show diff editor: left = original README, right = AI-generated README
    await vscode.commands.executeCommand('vscode.diff', readmeUri, tempReadmeUri, 'Review: README.md (Original vs AI-Generated Summary)');
    // Prompt to accept/reject
    const choice = await vscode.window.showInformationMessage('Do you want to accept the AI-generated summary for README.md?', 'Accept', 'Reject');
    if (choice === 'Accept') {
      await vscode.workspace.fs.writeFile(readmeUri, Buffer.from(newReadmeContent, 'utf8'));
      vscode.window.showInformationMessage('README.md updated with documentation summary.');
    } else {
      vscode.window.showInformationMessage('No changes applied to README.md.');
    }
    // Always delete temp file after review
    try {
      await vscode.workspace.fs.delete(tempReadmeUri);
    } catch {}
  });
}


export async function generateDocumentation(sourceUri: vscode.Uri) {
  try {
    // Show progress notification
    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: "Doc Helper",
      cancellable: false
    }, async (progress) => {
      progress.report({ message: "Reading source file..." });

      // Read the source file content
      const sourceContent = await vscode.workspace.fs.readFile(sourceUri);
      const code = Buffer.from(sourceContent).toString('utf8');
      
      // Determine language from file extension
      // Now for the demo, we use ts, tsx and js only
      const ext = path.extname(sourceUri.fsPath).toLowerCase();
      const language = ext === '.ts' || ext === '.tsx' ? 'typescript' : 'javascript';

      progress.report({ message: "Generating documentation with AI..." });

      // Generate documentation using AI
      const documentation = await aiService.generateDocumentation(code, language);

      progress.report({ message: "Creating documentation file..." });

      // Determine the documentation file path
      const folders = vscode.workspace.workspaceFolders;
      if (!folders?.length) {
        throw new Error('No workspace folder found');
      }

      const config = vscode.workspace.getConfiguration('docHelper');
      const docsDirectory = config.get<string>('saveDirectory') || 'docs/';
      const rel = vscode.workspace.asRelativePath(sourceUri, false);
      const docRel = rel
        .replace(/^src[\/\\]/, docsDirectory)
        .replace(/\.(ts|js|tsx|jsx)$/, '.md');
      
      const docUri = vscode.Uri.joinPath(folders[0].uri, ...docRel.split(/[\\/]/));
      
      // Ensure the docs directory exists
      const docDir = vscode.Uri.joinPath(docUri, '..');
      try {
        await vscode.workspace.fs.createDirectory(docDir);
      } catch {
        // Directory might already exist
      }

      // Write the documentation to file
      const docContent = Buffer.from(documentation, 'utf8');
      await vscode.workspace.fs.writeFile(docUri, docContent);

      progress.report({ message: "Opening generated documentation..." });

      // Open the generated documentation in editor
      const doc = await vscode.workspace.openTextDocument(docUri);
      await vscode.window.showTextDocument(doc);
    });

    vscode.window.showInformationMessage('Documentation generated successfully!');
  } catch (error) {
    console.error('Error generating documentation:', error);
    vscode.window.showErrorMessage(`Failed to generate documentation: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function summarizeDocumentation(docUri: vscode.Uri) {
  try {
    // Show progress notification
    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: "Doc Helper",
      cancellable: false
    }, async (progress) => {
      progress.report({ message: "Reading documentation file..." });

      // Read the documentation file content
      const docContent = await vscode.workspace.fs.readFile(docUri);
      const content = Buffer.from(docContent).toString('utf8');

      progress.report({ message: "Generating summary with AI..." });

      // Generate summary using AI
      const summary = await aiService.summarizeDocumentation(content);

      progress.report({ message: "Opening generated summary..." });
      // Create an untitled document for the summary
      const summaryContent = `# Summary\n\n${summary}\n\n---\n\n*This is an AI-generated summary of the documentation.*`;
      const doc = await vscode.workspace.openTextDocument({ content: summaryContent, language: 'markdown' });
      await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
    });

    vscode.window.showInformationMessage('Documentation summary generated successfully!');
  } catch (error) {
    console.error('Error summarizing documentation:', error);
    vscode.window.showErrorMessage(`Failed to summarize documentation: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function checkDocumentation(docUri: vscode.Uri) {
  try {
    // Show progress notification
    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: "Doc Helper",
      cancellable: false
    }, async (progress) => {
      progress.report({ message: "Reading documentation file..." });

      // Read the documentation file content
      const docContent = await vscode.workspace.fs.readFile(docUri);
      const documentation = Buffer.from(docContent).toString('utf8');

      progress.report({ message: "Finding corresponding source file..." });

      // Find the corresponding source file
      const folders = vscode.workspace.workspaceFolders;
      if (!folders?.length) {
        throw new Error('No workspace folder found');
      }

      const config = vscode.workspace.getConfiguration('docHelper');
      const docsDirectory = config.get<string>('saveDirectory') || 'docs/';
      const docRel = vscode.workspace.asRelativePath(docUri, false);
      // Convert docs path back to source path
      const base = docRel
        .replace(new RegExp('^' + docsDirectory.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'src/')
        .replace(/\.md$/, '');

      // Try to find the corresponding source file
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
          // not found, keep looking
        }
      }

      if (!sourceUri || !foundExt) {
        throw new Error('Could not find corresponding source file for this documentation');
      }

      progress.report({ message: "Reading source file..." });

      // Read the source file content
      const sourceContent = await vscode.workspace.fs.readFile(sourceUri);
      const code = Buffer.from(sourceContent).toString('utf8');
      
      // Determine language
      const language = foundExt === 'ts' || foundExt === 'tsx' ? 'typescript' : 'javascript';

      progress.report({ message: "Analyzing documentation issues with AI..." });

      // Detect issues using AI
      const rawIssues = await aiService.detectDocumentationIssues(code, documentation, language);

      progress.report({ message: "Generating issues report..." });

      // Create issues report
      let issuesReport = `# Documentation Issues Report\n\n`;
      issuesReport += `**Source File:** \`${vscode.workspace.asRelativePath(sourceUri, false)}\`\n`;
      issuesReport += `**Documentation File:** \`${docRel}\`\n`;
      issuesReport += `**Analysis Date:** ${new Date().toLocaleDateString()}\n\n`;

      issuesReport += `## 🔍 Issues Found:\n\n${rawIssues}\n\n`;
      
      if (!(rawIssues.trim().toLowerCase() === 'no significant issues found.')) {
        issuesReport += `---\n\n`;
        issuesReport += `### 📋 Next Steps\n`;
        issuesReport += `- Review each issue listed above\n`;
        issuesReport += `- Update the documentation to address the identified problems\n`;
        issuesReport += `- Consider regenerating documentation if major issues are found\n`;
      } else {
        issuesReport += `Your documentation looks good! 🎉\n\n`;
        issuesReport += `💡 To make your documentation even stronger, consider:\n`;
        issuesReport += `- Adding more detailed usage examples (covering edge cases or advanced scenarios).\n`;
        issuesReport += `- Including parameter and return type details for each function.\n`;
        issuesReport += `- Linking related functions/classes together for easier navigation.`;
      }

      issuesReport += `\n\n---\n\n*This analysis was generated by Doc Helper AI.*`;

      // Open the issues report in a new editor
      const doc = await vscode.workspace.openTextDocument({
        content: issuesReport,
        language: 'markdown'
      });
      await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
    });

    vscode.window.showInformationMessage('Documentation analysis completed!');
  } catch (error) {
    console.error('Error checking documentation:', error);
    vscode.window.showErrorMessage(`Failed to check documentation: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// Todo: inline suggestion
// Implementation for inline suggestion
export function registerInlineSuggestionProvider(context: vscode.ExtensionContext): vscode.Disposable {
  const provider = new DocumentationInlineSuggestionProvider();
  const selector = { language: 'markdown', scheme: 'file' };
  const disposable = vscode.languages.registerInlineCompletionItemProvider(selector, provider);
  context.subscriptions.push(disposable);
  return disposable;
}

// Todo: detect missing function instantly