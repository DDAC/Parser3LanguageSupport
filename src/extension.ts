'use strict';
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { DocumentationHelper } from './DocumentationHelper';
import { EditorHelper } from "./EditorHelper";
import { EditorCommand } from "./EditorCommand";
import { Parser3DefinitionProvider } from './Parser3DefinitionProvider';
import { Parser3Index } from './Parser3Index';
import { Parser3DocumentSymbolProvider, Parser3WorkspaceSymbolProvider } from './Parser3SymbolProvider';
import { Parser3HoverProvider } from './Parser3HoverProvider';
import { Parser3CodeNavigator } from './Parser3CodeNavigator';

//==================================================================================================

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

    // Use the console to output diagnostic information (console.log) and errors (console.error)
    // This line of code will only be executed once when your extension is activated
    console.log('Parser3 Extended Language Support extension is now active!');

	let documentationHelper = new DocumentationHelper();
	let codeNavigator = new Parser3CodeNavigator();
		
	let addDocumentingHeaderCommand = vscode.commands.registerCommand("parser3ext.addDocumentingComment", ()=>{
		ExecuteIfEditorIsActive((ed)=>{documentationHelper.InsertDocumentingComment(ed);});
	});

	let addDocumentingHeaderWithRemarksCommand = vscode.commands.registerCommand("parser3ext.addDocumentingCommentWithRemarks", ()=>{
		ExecuteIfEditorIsActive((ed)=>{documentationHelper.InsertDocumentingComment(ed, true);});
	});

	let commentSelectionCommand = vscode.commands.registerCommand("parser3ext.commentSelection", ()=>{
		ExecuteIfEditorIsActive((ed)=>{EditorHelper.CommentSelection(ed);});
	});

	let remSelectionCommand = vscode.commands.registerCommand("parser3ext.remSelection", ()=>{
		ExecuteIfEditorIsActive((ed)=>{EditorHelper.RemSelection(ed);});
	});

	let uncommentSelectionCommand = vscode.commands.registerCommand("parser3ext.uncommentSelection", ()=>{
		ExecuteIfEditorIsActive((ed)=>{EditorHelper.UncommentSelection(ed);});
	});

	let goToMethodCommand = vscode.commands.registerCommand("parser3ext.goToMethodDeclaration", ()=>{
		ExecuteIfEditorIsActive((ed)=>{codeNavigator.GoToMethodDeclaration(ed);});
	});

	let commentAwareTabShiftCommand = vscode.commands.registerCommand("parser3ext.commentAwareTabShift", ()=>{
		ExecuteIfEditorIsActive((ed)=>{EditorHelper.CommentAwareTabShift(ed);});
	});

	// commands
	context.subscriptions.push(addDocumentingHeaderCommand);
	context.subscriptions.push(addDocumentingHeaderWithRemarksCommand);
	context.subscriptions.push(commentSelectionCommand);
	context.subscriptions.push(remSelectionCommand);
	context.subscriptions.push(uncommentSelectionCommand);
	context.subscriptions.push(goToMethodCommand);
	context.subscriptions.push(commentAwareTabShiftCommand);

	// project index (classes, methods) for navigation
	let index = new Parser3Index();
	context.subscriptions.push(index);
	context.subscriptions.push(vscode.commands.registerCommand("parser3ext.rebuildIndex", () => {
		index.rebuild().then(() => {
			vscode.window.setStatusBarMessage("Parser3: indexed " + index.fileCount + " files", 3000);
		});
	}));
	index.rebuild();

	const P3_MODE: vscode.DocumentFilter = { language: 'parser3ext', scheme: '*' };

	// definition provider (F12 / Cmd+click)
	context.subscriptions.push(vscode.languages.registerDefinitionProvider(P3_MODE, new Parser3DefinitionProvider(index)));

	// symbols: outline, breadcrumbs, Go to Symbol in Editor / Workspace
	context.subscriptions.push(vscode.languages.registerDocumentSymbolProvider(P3_MODE, new Parser3DocumentSymbolProvider()));
	context.subscriptions.push(vscode.languages.registerWorkspaceSymbolProvider(new Parser3WorkspaceSymbolProvider(index)));

	// hover provider
	context.subscriptions.push(vscode.languages.registerHoverProvider(P3_MODE, new Parser3HoverProvider()));
}

function ExecuteIfEditorIsActive(commandToExecute:EditorCommand) {
	let editor = vscode.window.activeTextEditor;
		
	if (!editor) {
		vscode.window.showWarningMessage("Open a file first to utilize this extension.");
		return; // No open text editor
	}

	commandToExecute(editor);
}

// this method is called when your extension is deactivated
export function deactivate() {
}
