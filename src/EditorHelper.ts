'use strict';

import * as vscode from 'vscode';
import { Config } from './Config';

export class EditorHelper{

	public static async CommentSelection(editor : vscode.TextEditor){
		var selection = editor.selection;
		if(selection.end.character===0 
			&& selection.start.line !== selection.end.line){
			selection = new vscode.Selection(selection.start, selection.end.translate(-1));
		}
		for(var line=selection.start.line; line <= selection.end.line; line++ ){
			await editor.edit((ed)=>{
				var currentLine = editor.document.lineAt(line);
				var commentSymbolSuffix = Config.CommentSymbolSuffix;
				if(currentLine.text.startsWith("#")){
					commentSymbolSuffix = "";
				}
				ed.replace(currentLine.range, "#"+commentSymbolSuffix+currentLine.text);
			});	
		}
	}

	public static async RemSelection(editor : vscode.TextEditor){
		var selection = editor.selection;		
		editor.edit((ed)=>{
			ed.insert(selection.start, "^rem{" + Config.RemCommentSuffix);
			ed.insert(selection.end, Config.RemCommentSuffix + "}");
		});	
	}

	public static async UncommentSelection(editor : vscode.TextEditor){
		var selection = editor.selection;
		for(var line=selection.start.line; line <= selection.end.line; line++ ){
			await editor.edit((eb)=>{
				var currentLine = editor.document.lineAt(line);
				if(currentLine.text.startsWith("#")){
					eb.replace(currentLine.range, currentLine.text.substr(1+Config.CommentSymbolSuffix.length));
				}
			});	
		}
	}

	/**
	 * Cmd+/ replacement: Parser3 line comments must start at column 0, while the built-in
	 * toggle puts the marker at the indentation level. Works with multiple selections.
	 */
	public static async ToggleLineComment(editor : vscode.TextEditor){
		let suffix = Config.CommentSymbolSuffix;
		let document = editor.document;
		let lines = new Set<number>();
		editor.selections.forEach(selection => {
			let end = selection.end.line;
			if(selection.end.character === 0 && selection.start.line !== end){
				end--;
			}
			for(let line = selection.start.line; line <= end; line++){
				lines.add(line);
			}
		});
		let targets = Array.from(lines).sort((a, b) => a - b);
		let nonBlank = targets.filter(line => document.lineAt(line).text.trim() !== "");
		if(nonBlank.length === 0){
			nonBlank = targets;
		}
		let allCommented = nonBlank.every(line => document.lineAt(line).text.startsWith("#"));
		await editor.edit(eb => {
			nonBlank.forEach(line => {
				let text = document.lineAt(line).text;
				if(allCommented){
					let cut = 1;
					if(suffix !== "" && text.startsWith("#" + suffix)){
						cut = 1 + suffix.length;
					}
					eb.delete(new vscode.Range(line, 0, line, cut));
				}else{
					eb.insert(new vscode.Position(line, 0), "#" + suffix);
				}
			});
		});
	}

	public static async CommentAwareTabShift(editor : vscode.TextEditor){
		var selection = editor.selection;
		// ordinary TAB behavior
		if(selection.start.line === selection.end.line){
			await editor.edit((ed)=>{
				if(selection.start.character === selection.end.character){
					ed.insert(selection.start, "\t");
				}else{
					ed.replace(selection, "\t");
					editor.selection = new vscode.Selection(selection.end, selection.end);
				}
			});	
			return;
		}
		for(var line=selection.start.line; line <= selection.end.line; line++ ){
			await editor.edit((ed)=>{
				var currentLine = editor.document.lineAt(line);
				if(line === selection.end.line && selection.end.character===0){
					return;
				}
				if(currentLine.text.startsWith("#")){
					if(Config.IsAllowCommentAwareTabCommentsShift){
						ed.insert(currentLine.range.start.translate(0,1), "\t");
					}					
				}else{
					ed.insert(currentLine.range.start, "\t");
				}
			});	
		}
	}

	public static GetCurrentString(editor : vscode.TextEditor, selection : vscode.Selection):string{
		let lineSelection = selection.end.translate(0,10000);
		return editor.document.getText(new vscode.Selection(selection.start, lineSelection)).trim();
	}
	
	public static ExpandSelection(selection:vscode.Selection):vscode.Selection{
		let nextLine = selection.end.translate(1,0);
		return new vscode.Selection(selection.start, nextLine);
	}
	
	public static InsertNewLine(editor : vscode.TextEditor, selection : vscode.Selection):void{
		let newLineSnippet = new vscode.SnippetString("\n");
		editor.insertSnippet(newLineSnippet,selection.start);
	}
	
	public static MoveCursorToTheLineStart(editor: vscode.TextEditor, selection : vscode.Selection):vscode.Selection{
		editor.selection = new vscode.Selection(new vscode.Position(selection.start.line,0),new vscode.Position(selection.start.line,0));
		return editor.selection;
	}

	public static GetSelectionAtTheLineStart(editor: vscode.TextEditor, selection : vscode.Selection):vscode.Selection{
		return new vscode.Selection(new vscode.Position(selection.start.line,0),new vscode.Position(selection.start.line,0));
	}
	
	public static async GetInputFromUser(descriptiveMessage : string, placeholder:string):Promise<string>{
		let userInput = await vscode.window.showInputBox({
			prompt:descriptiveMessage,
			placeHolder:placeholder
		});
		if(userInput === undefined || userInput === ""){
			return placeholder;
		}
		return userInput;
	}
	
	public static GetMethodArguments(signatureString:string):string[]{
		let foundArguments : string[] = [];
		
		let pattern = /@\w+\[([^\[]*)\]/;
	
		let results = pattern.exec(signatureString);
		
		if(results !== null){
			results.shift();
			results.forEach(r=>{
				let parts = r.split(";");
				parts.forEach(p=>{
					foundArguments.push(p);
				});			
			});
		}	
	
		return foundArguments;
	}
}