import * as vscode from 'vscode';
import { runShellCommand } from '../utils/runShellCommand';

export class VersionControlViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'doc-helper-version-control';

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
            ]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(async data => {
            switch (data.type) {
                case 'runCommand':
                    {
                        const { command, args } = data.value;
                        let output: string | object = '';
                        if (command === 'git' && args[0] === 'log') {
                            const logArgs = ['log', '--pretty=format:%H%n%an%n%ad%n%s', '--date=iso'];
                            const rawOutput = await runShellCommand(command, logArgs);
                            const commits = rawOutput.split('\n\n').filter(Boolean).map(entry => {
                                const lines = entry.split('\n');
                                return {
                                    hash: lines[0],
                                    author: lines[1],
                                    date: lines[2],
                                    message: lines.slice(3).join('\n').trim()
                                };
                            });
                            output = commits;
                        } else {
                            // Handle other commands if necessary, or just return an error/empty
                            output = `Unsupported command: ${command} ${args.join(' ')}`;
                        }
                        webviewView.webview.postMessage({ type: 'commandOutput', value: output });
                        break;
                    }
                case 'revertCommit':
                    {
                        const { commitHash } = data.value;
                        const output = await runShellCommand('git', ['revert', '--no-edit', commitHash]);
                        webviewView.webview.postMessage({ type: 'commandOutput', value: `Revert command output:\n${output}` });
                        break;
                    }
            }
        });
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        // Get the local path to main script run in the webview, then convert it to a uri we can use in the webview.
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'src', 'webview', 'versionControl.js'));

        // Do the same for the stylesheet.
        const styleMainUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'src', 'webview', 'versionControl.css'));

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
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">

				<meta name="viewport" content="width=device-width, initial-scale=1.0">

				<link href="${styleMainUri}" rel="stylesheet">

				<title>Version Control</title>
			</head>
			<body>
                <h1>Git History</h1>
                <button id="log-button">Refresh History</button>

                <hr>

				<div id="log-output"></div>
                <pre id="command-output"></pre>

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