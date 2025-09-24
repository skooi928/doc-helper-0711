import * as vscode from 'vscode';
import * as path from 'path';
import { getWorkspaceConfig } from '../utils/doch';
import { AIService } from '../ai/temporaryAI';
import { DocumentationInlineSuggestionProvider } from '../providers/documentInlineSuggestionProvider';
import { askDocumentationQuestion } from '../service/apiCall';

const aiService = new AIService();

export async function generateDocumentation(sourceUri: vscode.Uri, replace: boolean = true) {
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

      progress.report({ message: "Generating documentation for '" + vscode.workspace.asRelativePath(sourceUri, false) + "' with AI..." });

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

      const docsDirectory = vscode.workspace.getConfiguration('docHelper').get<string>('saveDirectory') || 'docs/';

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

      if (replace){
        progress.report({ message: "Creating documentation file..." });

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
      } else {
        progress.report({ message: "Opening generated documentation with diff view..." });
        if (!docRel) {
          throw new Error('Could not determine documentation file path. Check your source directories configuration.');
        }
        const originalDocUri = vscode.Uri.joinPath(folder.uri, ...docRel.split(/[\\/]/));
        // Open the generated documentation in a new untitled editor
        const preview = await vscode.workspace.openTextDocument({ content: documentation, language: 'markdown' });
        await vscode.commands.executeCommand('vscode.diff', originalDocUri, preview.uri, `Diff: ${path.basename(originalDocUri.fsPath)} Original ↔ AI Generated`);
      }
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

      progress.report({ message: "Generating summary for '" + vscode.workspace.asRelativePath(docUri, false) + "' with AI..." });

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
      vscode.window.showInformationMessage('Documentation analysis completed!');
      if (rawIssues.trim().toLowerCase() !== 'no significant issues found.') {
        progress.report({ message: "Waiting for user's next action..." });
        const userNextAction = await vscode.window.showInformationMessage(
          'Issues were found in the documentation. Would you like to regenerate the documentation using AI?',
          'Regenerate', 'Ignore'
        );
        if (userNextAction === 'Regenerate' && sourceUri) {
          await generateDocumentation(sourceUri, false);
        } // else ignore
      }
    });
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

// Documentation types for AI generation
export interface DocumentationType {
  label: string;
  description: string;
  fileName: string;
  prompt: string;
}

export const documentTypes: DocumentationType[] = [
  {
    label: 'README.md',
    description: 'Project overview and getting started guide',
    fileName: 'README.md',
    prompt: 'Generate a comprehensive README.md file for this project. Include project overview, features, installation instructions, usage examples, and contribution guidelines. Make it professional and informative based on the project structure and files.'
  },
  {
    label: 'ARCHITECTURE.md',
    description: 'System architecture and design overview',
    fileName: 'ARCHITECTURE.md',
    prompt: 'Generate a detailed ARCHITECTURE.md file for this project. Include system design overview, component descriptions, data flow diagrams (in text/markdown format), technology stack analysis, and architectural decisions. Analyze the codebase structure to provide accurate architectural information.'
  },
  {
    label: 'ROADMAP.md',
    description: 'Project roadmap and future plans',
    fileName: 'ROADMAP.md',
    prompt: 'Generate a ROADMAP.md file for this project. Include current version status, upcoming features organized by timeframes (short-term, medium-term, long-term), known issues, and completed milestones. Base this on the current state of the project and logical next steps for development.'
  },
  {
    label: 'CONFIGURATION.md',
    description: 'Configuration options and setup instructions',
    fileName: 'CONFIGURATION.md',
    prompt: 'Generate a CONFIGURATION.md file for this project. Include environment variables, configuration files analysis, development and production setup instructions, and troubleshooting guide. Analyze configuration files in the project to provide accurate setup information.'
  },
  {
    label: 'API.md',
    description: 'API documentation and endpoint reference',
    fileName: 'API.md',
    prompt: 'Generate an API.md file for this project. Include API endpoints documentation, authentication methods, request/response examples, error codes, and usage examples. Analyze the backend code to identify and document actual API endpoints and their functionality.'
  }
];

export async function generateGeneralDocumentations(selectedType: DocumentationType): Promise<void> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) {
    vscode.window.showErrorMessage('No workspace folder found');
    return;
  }

  const workspaceRoot = folders[0].uri;
  const filePath = vscode.Uri.joinPath(workspaceRoot, selectedType.fileName);

  try {
    // Check if file already exists
    await vscode.workspace.fs.stat(filePath);
    const overwrite = await vscode.window.showWarningMessage(
      `${selectedType.fileName} already exists. Do you want to overwrite it?`,
      'Overwrite',
      'Cancel'
    );
    if (overwrite !== 'Overwrite') {
      return;
    }
  } catch {
    // File doesn't exist, which is fine
  }

  // Show progress
  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: `Generating ${selectedType.fileName}...`,
    cancellable: false
  }, async (progress) => {
    try {
      progress.report({ message: 'Analyzing project structure...' });
      
      // Collect project files for AI context
      const projectFiles: { name: string; content: string }[] = [];
      
      // Get package.json for project info
      try {
        const packageJsonUri = vscode.Uri.joinPath(workspaceRoot, 'package.json');
        const packageJsonContent = await vscode.workspace.fs.readFile(packageJsonUri);
        projectFiles.push({
          name: 'package.json',
          content: Buffer.from(packageJsonContent).toString('utf8')
        });
      } catch {
        // package.json doesn't exist
      }

      // Get README.md if it exists for context
      try {
        const readmeUri = vscode.Uri.joinPath(workspaceRoot, 'README.md');
        const readmeContent = await vscode.workspace.fs.readFile(readmeUri);
        projectFiles.push({
          name: 'README.md',
          content: Buffer.from(readmeContent).toString('utf8')
        });
      } catch {
        // README.md doesn't exist
      }

      // Get main source files
      const pattern = new vscode.RelativePattern(workspaceRoot, '**/*.{ts,js,py,java,cs,cpp,c,h,hpp,json,yml,yaml}');
      const excludePattern = '{**/node_modules/**,**/dist/**,**/build/**,**/out/**,**/.next/**,**/coverage/**,**/.git/**,**/.vscode/**,**/vendor/**,**/target/**,**/bin/**,**/obj/**}';
      const sourceFiles = await vscode.workspace.findFiles(pattern, excludePattern, 10);

      // Filter and prioritize user source files
      const userSourceFiles = sourceFiles.filter(file => {
        const relativePath = vscode.workspace.asRelativePath(file);
        // Additional filtering for common generated/dependency patterns
        return !relativePath.includes('node_modules') &&
               !relativePath.includes('dist/') &&
               !relativePath.includes('build/') &&
               !relativePath.includes('.git/') &&
               !relativePath.includes('coverage/') &&
               !relativePath.includes('vendor/') &&
               !relativePath.includes('target/') &&
               !relativePath.includes('__pycache__/') &&
               !relativePath.includes('.pytest_cache/') &&
               !relativePath.endsWith('.min.js') &&
               !relativePath.endsWith('.bundle.js') &&
               !relativePath.includes('webpack.config') &&
               !relativePath.includes('rollup.config') &&
               !relativePath.includes('vite.config');
      });

      // Prioritize main source directories (src, lib, app, etc.)
      const prioritizedFiles = userSourceFiles.sort((a, b) => {
        const aPath = vscode.workspace.asRelativePath(a);
        const bPath = vscode.workspace.asRelativePath(b);
        
        // Prioritize files in src/, lib/, app/ directories
        const aPriority = (aPath.startsWith('src/') ? 3 : 0) + 
                         (aPath.startsWith('lib/') ? 2 : 0) + 
                         (aPath.startsWith('app/') ? 2 : 0) +
                         (aPath.includes('index.') ? 1 : 0) +
                         (aPath.includes('main.') ? 1 : 0);
                         
        const bPriority = (bPath.startsWith('src/') ? 3 : 0) + 
                         (bPath.startsWith('lib/') ? 2 : 0) + 
                         (bPath.startsWith('app/') ? 2 : 0) +
                         (bPath.includes('index.') ? 1 : 0) +
                         (bPath.includes('main.') ? 1 : 0);
        
        return bPriority - aPriority;
      });
      
      // Take top 10 most relevant files to avoid token limits
      for (const file of prioritizedFiles.slice(0, 10)) {
        try {
          const content = await vscode.workspace.fs.readFile(file);
          const fileName = vscode.workspace.asRelativePath(file);
          projectFiles.push({
            name: fileName,
            content: Buffer.from(content).toString('utf8').slice(0, 2000) // Limit content size
          });
        } catch {
          // Skip files that can't be read
        }
      }

      progress.report({ message: 'Generating content with AI...' });
      
      // Generate content using AI
      const enhancedPrompt = `${selectedType.prompt}

      Project context: This appears to be a ${projectFiles.find(f => f.name === 'package.json') ? 'Node.js/TypeScript' : 'software'} project.

      Please analyze the provided project files and generate a comprehensive ${selectedType.fileName} document with accurate, specific information about this project. Make sure to:
      1. Use actual project details from the files provided
      2. Include specific technical information where relevant
      3. Format the output as proper Markdown
      4. Make it professional and detailed
      5. Include real examples and code snippets where appropriate

      Generate the complete ${selectedType.fileName} file content now:`;

      const aiContent = await askDocumentationQuestion(1, enhancedPrompt, projectFiles);
      
      progress.report({ message: 'Creating file...' });
      
      // Create the file with AI-generated content
      await vscode.workspace.fs.writeFile(filePath, Buffer.from(aiContent, 'utf8'));
      
      progress.report({ message: 'Opening file...' });
      
      // Open the file
      const document = await vscode.workspace.openTextDocument(filePath);
      await vscode.window.showTextDocument(document);
      
      vscode.window.showInformationMessage(`Generated ${selectedType.fileName} successfully with AI!`);
    } catch (error: any) {
      console.error('Error generating documentation:', error);
      vscode.window.showErrorMessage(`Failed to generate ${selectedType.fileName}: ${error.message}`);
    }
  });
}