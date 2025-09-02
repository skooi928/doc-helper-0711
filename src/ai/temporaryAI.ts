// THIS IS A TEMPORARY FILE FOR DEMO PURPOSES ONLY
// Real implementation will be in the backend folder with Spring Boot

// For demo, we will use vscode api

import * as vscode from 'vscode';

export class AIService {
    constructor() {}

    private async getLanguageModel(): Promise<vscode.LanguageModelChat | null> {
        try {
            const models = await vscode.lm.selectChatModels({
                vendor: 'copilot',
                family: 'gpt-4o-mini'
            });
            
            if (models.length === 0) {
                const allModels = await vscode.lm.selectChatModels({});
                return allModels.length > 0 ? allModels[0] : null;
            }
            
            return models[0];
        } catch (error) {
            console.error('Failed to get language model:', error);
            return null;
        }
    }

    async generateDocumentation(code: string, language: string, context?: string): Promise<string> {
        const model = await this.getLanguageModel();
        if (!model) {
            throw new Error('No language model available. Please ensure you have GitHub Copilot or other language models enabled in VS Code.');
        }

        const messages = [
            vscode.LanguageModelChatMessage.User(
                `You are a technical documentation expert. Generate comprehensive documentation for the following ${language} code.
                
                  Please provide:
                  1. A clear description of what the code does
                  2. For every function/method provide:
                    2.1 Parameter explanations
                    2.2 Return value description 
                    2.3 Usage examples
                  3. Mermaid flowcharts or diagrams (if applicable)
                  4. Any important notes or warnings

                  Format the response in Markdown. Be concise but thorough.`
            ),
            vscode.LanguageModelChatMessage.User(`Code to document:
                  \`\`\`${language}
                  ${code}
                  \`\`\`

                  ${context ? `Additional context: ${context}` : ''}`)
        ];

        try {
            const response = await model.sendRequest(
                messages, 
                {}, 
                new vscode.CancellationTokenSource().token
            );
            
            let documentation = '';
            for await (const fragment of response.text) {
                documentation += fragment;
            }
            
            return documentation;
        } catch (error) {
            if (error instanceof vscode.LanguageModelError) {
                throw new Error(`Language model error: ${error.message}`);
            }
            throw new Error(`Failed to generate documentation: ${error}`);
        }
    }

    async summarizeDocumentation(content: string): Promise<string> {
        const model = await this.getLanguageModel();
        if (!model) {
            throw new Error('No language model available. Please ensure you have GitHub Copilot or other language models enabled in VS Code.');
        }

        const messages = [
            vscode.LanguageModelChatMessage.User(
                `Create a concise summary of the following documentation. Include:
                    1. Main purpose/overview
                    2. Key components or features
                    3. Important usage notes

                    Keep the summary brief but informative.`
            ),
            vscode.LanguageModelChatMessage.User(`Documentation content:
                ${content}`)
        ];

        try {
            const response = await model.sendRequest(
                messages,
                {},
                new vscode.CancellationTokenSource().token
            );

            let summary = '';
            for await (const fragment of response.text) {
                summary += fragment;
            }

            return summary;
        } catch (error) {
            if (error instanceof vscode.LanguageModelError) {
                throw new Error(`Language model error: ${error.message}`);
            }
            throw new Error(`Failed to summarize documentation: ${error}`);
        }
    }

    async detectDocumentationIssues(code: string, documentation: string, language: string): Promise<string> {
        const model = await this.getLanguageModel();
        if (!model) {
            throw new Error('No language model available. Please ensure you have GitHub Copilot or other language models enabled in VS Code.');
        }

        const messages = [
            vscode.LanguageModelChatMessage.User(
           `Evaluate if the documentation meets these quality standards. Only report issues if there are SIGNIFICANT problems:

               ✅ GOOD DOCUMENTATION should have:
               - All major functions/classes are documented
               - Basic explanations of what each function does
               - At least one usage example or basic usage info
               - Clean markdown formatting (doesn't need to be perfect)
               - Documentation generally matches the code

               Only flag issues if:
               - Major functions are completely undocumented
               - Documentation is severely outdated or incorrect
               - No examples or usage guidance at all
               - Documentation is completely unreadable

               If the documentation meets the basic standards above, respond with "No significant issues found."
               Otherwise, list only the major problems that need attention.`
            ),
            vscode.LanguageModelChatMessage.User(`Code (${language}):
                    \`\`\`${language}
                    ${code}
                    \`\`\`

                    Documentation:
                    ${documentation}`)
        ];

        try {
            const response = await model.sendRequest(
                messages,
                {},
                new vscode.CancellationTokenSource().token
            );
            
            let issuesText = '';
            for await (const fragment of response.text) {
                issuesText += fragment;
            }
            
            return issuesText;
        } catch (error) {
            if (error instanceof vscode.LanguageModelError) {
                throw new Error(`Language model error: ${error.message}`);
            }
            throw new Error(`Failed to detect documentation issues: ${error}`);
        }
    }
}