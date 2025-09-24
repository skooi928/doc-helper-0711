import * as vscode from 'vscode';
import * as path from 'path';
import { askDocumentationQuestion } from '../service/apiCall';

export class ChatbotViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'doc-helper-chatbot';

    private _view?: vscode.WebviewView;

    constructor(
        private readonly _extensionUri: vscode.Uri,
    ) { }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            // Allow scripts in the webview
            enableScripts: true,
            localResourceRoots: [
                this._extensionUri
            ],
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // setTimeout(() => {
        //     webviewView.webview.postMessage({ type: 'restoreState' });
        // }, 100);

        // when the view is hidden, trigger a save
        webviewView.onDidChangeVisibility(() => {
            if (!webviewView.visible) {
                webviewView.webview.postMessage({ type: 'saveState' });
            } else {
                webviewView.webview.postMessage({ type: 'restoreState' });
            }
        });

        webviewView.webview.onDidReceiveMessage(async data => {
            switch (data.type) {
                case 'askQuestion': {
                    const question: string = data.value;
                    
                    // Use a fixed userId (e.g., 1) for demonstration purposes.
                    // In a real application, user sessions is needed. So everyone can have their memory session to access with the chatbot.
                    try {
                        const answer = await askDocumentationQuestion(1, question, data.files); // add files
                        webviewView.webview.postMessage({ type: 'addAIAnswer', value: answer });
                    } catch (error: any) {
                        const errorMsg = 'Error: ' + error.message;
                        webviewView.webview.postMessage({ type: 'addAIAnswer', value: errorMsg });
                    }
                    break;
                }
                case 'closeWindow': {
                    if (this._view?.onDidDispose) {
                        webviewView.webview.postMessage({type:'saveState'});
                    }
                    break;
                }
            }
        });

        // Send the active editor file to the webview
        const sendActiveEditorFile = () => {
            const activeEditor = vscode.window.activeTextEditor;
            if (activeEditor) {
                const fileName = path.basename(activeEditor.document.fileName);
                const fileContent = activeEditor.document.getText();
                webviewView.webview.postMessage({ type: 'activeEditor', file: { name: fileName, content: fileContent } });
            }
        };
        sendActiveEditorFile();
        vscode.window.onDidChangeActiveTextEditor(sendActiveEditorFile);
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        // Get the local path to main script run in the webview, then convert it to a uri we can use in the webview.
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'webview', 'chatbot.js'));

        // Do the same for the stylesheet.
        const styleMainUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'webview', 'chatbot.css'));
        const styleVscodeUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'webview', 'vscode.css'));

        // Use a nonce to only allow a specific script to be run.
        const nonce = getNonce();

        return `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">

				<!--
					Use a content security policy to only allow loading images from https or from our extension directory,
					and only allow scripts that have a specific nonce.
				-->
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} https:; font-src ${webview.cspSource};">

				<meta name="viewport" content="width=device-width, initial-scale=1.0">

				<link href="${styleMainUri}" rel="stylesheet">
                <link href="${styleVscodeUri}" rel="stylesheet">

				<title>Doc Helper AI</title>
			</head>
			<body>
				<div id="chat-container">
					<div id="chat-messages"></div>
					<div id="chat-input-container">
						<div id="uploaded-files"></div>
						<div id="chat-input-wrapper">
							<textarea id="chat-input" placeholder="Ask about your documentation..." rows="1"></textarea>
							<div class="input-actions">
								<button id="upload-button" title="Upload file">
									<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
										<path d="M7.5 2.5V12h1V2.5l3.25 3.25.707-.707L8 .586 3.543 5.043l.707.707L7.5 2.5z"/>
										<path d="M2 8v6a1 1 0 001 1h10a1 1 0 001-1V8h-1v6H3V8H2z"/>
									</svg>
								</button>
								<button id="send-button" title="Send message" disabled>
									<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
										<path d="M1.724 1.053a.5.5 0 01.671-.583l12.5 6a.5.5 0 010 .894l-12.5 6a.5.5 0 01-.671-.583L3.227 8 1.724 1.053zM3.92 7L2.695 2.525 12.998 7H3.92zm0 2h9.078L2.695 13.475 3.92 9z"/>
									</svg>
								</button>
							</div>
						</div>
					</div>
					<input type="file" id="file-input" multiple accept=".txt,.md,.json,.js,.ts,.py,.java,.cpp,.c,.h,.hpp,.cs,.php,.rb,.go,.rs,.swift,.kt,.scala,.sh,.yml,.yaml,.xml,.html,.css,.sql">
				</div>

				<script nonce="${nonce}" src="${scriptUri}"></script>
			</body>
			</html>`;
    }
}

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
