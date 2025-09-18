import * as vscode from 'vscode';
import * as path from 'path';
import { AIService } from '../ai/temporaryAI';
import { getWorkspaceConfig } from '../utils/doch';

const aiService = new AIService();

// Helper function to find the corresponding source file for a documentation file
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
  const { extensions } = await getWorkspaceConfig(folder);
  
  for (const ext of extensions) {
    const candidate = `${base}.${ext}`;
    const candidateUri = vscode.Uri.joinPath(folder.uri, ...candidate.split(/[\\/]/));
    try {
      await vscode.workspace.fs.stat(candidateUri);
      return candidateUri;
    } catch {
      // not found, keep looking
    }
  }
  
  return undefined;
}

export class DocumentationInlineSuggestionProvider implements vscode.InlineCompletionItemProvider {
  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken
  ): Promise<vscode.InlineCompletionItem[] | vscode.InlineCompletionList | null> {
    // Only provide suggestions for markdown files that appear to be documentation
    const docPath = vscode.workspace.asRelativePath(document.uri);
    const config = vscode.workspace.getConfiguration('docHelper');
    const docsDirectory = config.get<string>('saveDirectory') || 'docs/';
    
    if (!docPath.startsWith(docsDirectory) || !docPath.endsWith('.md')) {
      return null;
    }
    
    // Find the corresponding source file
    const sourceUri = await findCorrespondingSourceFile(document.uri);
    if (!sourceUri) {
      return null;
    }
    
    // Read the source content
    try {
      const sourceContent = await vscode.workspace.fs.readFile(sourceUri);
      const sourceCode = Buffer.from(sourceContent).toString('utf8');
      
      // Determine language
      const language = path.extname(sourceUri.fsPath).toLowerCase();
      
      // Get the current document content
      const docContent = document.getText();
      
      // Get suggestion from AI
      const suggestion = await aiService.getInlineSuggestion(
        docContent,
        sourceCode,
        language,
        position
      );
      
      if (suggestion) {
        return [
          new vscode.InlineCompletionItem(
            suggestion,
            new vscode.Range(position, position)
          )
        ];
      }
    } catch (error) {
      console.error('Error providing inline completion:', error);
    }
    
    return null;
  }
}