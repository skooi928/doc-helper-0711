// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { initDochRepo, updateDochContext } from './utils/doch';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// // Use the console to output diagnostic information (console.log) and errors (console.error)
	// // This line of code will only be executed once when your extension is activated
	// console.log('Congratulations, your extension "doc-helper-0711" is now active!');

	// // The command has been defined in the package.json file
	// // Now provide the implementation of the command with registerCommand
	// // The commandId parameter must match the command field in package.json
	// const disposable = vscode.commands.registerCommand('doc-helper-0711.helloWorld', () => {
	// 	// The code you place here will be executed every time your command is executed
	// 	// Display a message box to the user
	// 	vscode.window.showInformationMessage('Hello World from Doc Helper!');
	// });

	// context.subscriptions.push(disposable);

	// Update on start
	updateDochContext();

	// watch for changes in .doch
	const watcher = vscode.workspace.createFileSystemWatcher('**/.doch/**');
  	watcher.onDidCreate(() => updateDochContext());
  	watcher.onDidDelete(() => updateDochContext());
  	context.subscriptions.push(watcher);

	// Initialize .doch folder when opened a new folder
	// Register a one‐off “init repo” command
	const initCmd = vscode.commands.registerCommand(
		'doc-helper-0711.initDochRepo',
		async () => {
		// first prompt to open a folder if none is open
		if (!vscode.workspace.workspaceFolders?.length) {
			await vscode.commands.executeCommand('vscode.openFolder');
		}
		// then initialise .doch in every open folder
		vscode.workspace.workspaceFolders?.forEach(initDochRepo);
		await vscode.commands.executeCommand('setContext', 'docHelper:dochInitialized', true);
		}
	);
	context.subscriptions.push(initCmd);

}

// This method is called when your extension is deactivated
export function deactivate() {}
