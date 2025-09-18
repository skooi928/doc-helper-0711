import * as vscode from 'vscode';
import * as path from 'path';
import { getWorkspaceConfig } from '../utils/doch';
import { AIService } from '../ai/temporaryAI';
import { DocumentationInlineSuggestionProvider } from '../providers/documentInlineSuggestionProvider';

const aiService = new AIService();

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
      const language = path.extname(sourceUri.fsPath).toLowerCase();

      progress.report({ message: "Generating documentation with AI..." });

      // Determine the documentation file path
      const folders = vscode.workspace.workspaceFolders;
      if (!folders?.length) {
        throw new Error('No workspace folder found');
      }

      const folder = folders[0];
      const { extensions, regex, sourceDirectories } = await getWorkspaceConfig(folder);

      // If extension found is not same as file extension, warn user
      if (!extensions.includes(language.replace(/^\./, ''))) {
        vscode.window.showWarningMessage(`File extension '.${language}' is not in the allowed list: ${extensions.join(', ')}`);
        // stop here
        throw new Error('File extension not allowed. Try configure inside config.yml.');
      }

      // Generate documentation using AI
      const documentation = await aiService.generateDocumentation(code, language);

      progress.report({ message: "Creating documentation file..." });

      const config = vscode.workspace.getConfiguration('docHelper');
      const docsDirectory = config.get<string>('saveDirectory') || 'docs/';

      const rel = vscode.workspace.asRelativePath(sourceUri, false);
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
        throw new Error('Could not determine documentation file path. Check your source directories configuration.');
      }
      
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

      const folder = folders[0];
      const { extensions, sourceDirectories } = await getWorkspaceConfig(folder);

      const config = vscode.workspace.getConfiguration('docHelper');
      const docsDirectory = config.get<string>('saveDirectory') || 'docs/';
      const docRel = vscode.workspace.asRelativePath(docUri, false);

      let sourceUri: vscode.Uri | undefined;
      let foundExt: string | undefined;

      for (const dir of sourceDirectories) {
        // Convert docs path back to source path
        const base = docRel
          .replace(new RegExp('^' + docsDirectory.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${dir}/`)
          .replace(/\.md$/, '');

        for (const ext of extensions) {
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
        if (sourceUri && foundExt) {
          break;
        } // else continue with another source directory
      }

      if (!sourceUri || !foundExt) {
        throw new Error('Could not find corresponding source file for this documentation');
      }

      progress.report({ message: "Reading source file..." });

      // Read the source file content
      const sourceContent = await vscode.workspace.fs.readFile(sourceUri);
      const code = Buffer.from(sourceContent).toString('utf8');

      progress.report({ message: "Analyzing documentation issues with AI..." });

      // Detect issues using AI
      const rawIssues = await aiService.detectDocumentationIssues(code, documentation, foundExt);

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