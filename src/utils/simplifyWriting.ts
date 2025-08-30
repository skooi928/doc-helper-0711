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