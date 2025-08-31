import * as vscode from 'vscode';
import * as path from 'path';
import { AIService } from '../ai/temporaryAI';

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

      const rel = vscode.workspace.asRelativePath(sourceUri, false);
      const docRel = rel
        .replace(/^src[\/\\]/, 'docs/')
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