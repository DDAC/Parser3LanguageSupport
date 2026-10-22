'use strict';

import * as vscode from 'vscode';
import {Symbol, SymbolType, SymbolHelper} from './SymbolHelper';
import { MarkdownBuilder } from './MarkdownBuilder';
import { Config } from './Config';
import * as xdoc from "xmldoc";
import { KeyValuePair } from './Core';

export class DocumentingHeader{
	Summary : string | undefined;
	ParemterDescriptions : Array<KeyValuePair<string,string>> | undefined;
	Returns : string | undefined;
	Remarks : string | undefined;
}

export class Parser3HoverProvider implements vscode.HoverProvider {

	private GetDocumentingHeaderStrings(documentText : string, indexOfMethodDecalaration : number) : string[]{
		let stringArray : string[] = [];
		let charArray : string[] = [];
		let i = indexOfMethodDecalaration;
		let isFirstString = true; // to skip first newline character
		let allowedEmptyStringsCount = Config.AllowedEmptyLinesCount;

		while(true){
			i = i-1;
			if(i<0){
				break;
			}
			let char = documentText.charAt(i);
			if(char === '\n'){
				if(isFirstString){
					isFirstString = false;
					continue;
				}else{
					let string = charArray.reverse().join("~~~").replace(/~~~/g,""); // to assemble string from the array of chars
					if(string.trim() === "" && allowedEmptyStringsCount > 0){
						// skip allowed ammount of empty lines
						allowedEmptyStringsCount = allowedEmptyStringsCount-1;
						charArray = [];
						continue;
					}
					if(string.startsWith("###")){
						stringArray.push(string.substr(3).trim());
						charArray = [];
					}else{
						break;
					}					
				}
			}else{
				charArray.push(char);
			}
		}
		return stringArray.reverse();
	}

	private GetDocumentingHeader(documentText : string, indexOfMethodDecalaration : number) : DocumentingHeader | undefined{
		let headerStrings = this.GetDocumentingHeaderStrings(documentText, indexOfMethodDecalaration);
		if(headerStrings.length === 0){
			return undefined;
		}
		let headerXml : string = "<header>"; // xml should have root element

		headerStrings.forEach(string => {
			headerXml += string;
		});
		
		headerXml+="</header>"; // close root element

		var doc = new xdoc.XmlDocument(headerXml);
		var ret = new DocumentingHeader();

		/* header example
		### <summary>
		### Method summary
		### </summary>
		### <param name="hData">Hash</param>
		### <param name="hRet">Hash</param>
		### <remarks>
		### Test
		### </remarks>
		### <returns>
		### Returns description
		### </returns>
		@case_submit[hData;hRet]
		*/
		
		let summary = doc.childNamed("summary");
		let remarks = doc.childNamed("remarks");
		let returns = doc.childNamed("returns");
		let parameters = doc.childrenNamed("param");

		if(summary){
			ret.Summary = summary.val;
		}
		if(remarks){
			ret.Remarks = remarks.val;
		}
		if(returns){
			ret.Returns = returns.val;
		}
		if(parameters && parameters.length !== 0){
			ret.ParemterDescriptions = new Array<KeyValuePair<string,string>>();

			parameters.forEach(param=>{
				let variableName = param.attr["name"];
				let variableDescription = param.val;
				if(ret.ParemterDescriptions){
					ret.ParemterDescriptions.push(new KeyValuePair<string,string>(variableName, variableDescription));
				}
			});
		}
		return ret;
	}

	private GetDocumentationFromDocumentingHeader(symbol : Symbol) : vscode.MarkdownString{
		let ret = new vscode.MarkdownString();

		let documentText = symbol.Document.getText();

		let indexOfMethodDecalaration = documentText.indexOf("@"+symbol.ClearName);

		if(indexOfMethodDecalaration === -1){
			ret.appendText("No method '"+symbol.ClearName+"' declaration found in current document.");
			return ret;
		}
		
		let header = this.GetDocumentingHeader(documentText, indexOfMethodDecalaration);
		if(!header){
			ret.appendText("No method '"+symbol.ClearName+"' declaration found in current document.");
			return ret;
		}

		let mb = new MarkdownBuilder();
		ret = mb.BuildMarkdown(header);	

		return ret;
	}

    public provideHover(
		document: vscode.TextDocument, 
		position: vscode.Position, 
		token: vscode.CancellationToken):Thenable<vscode.Hover> 
	{
		let editor = vscode.window.activeTextEditor;
		if (!editor) {
			// hover inside diff/peek views has no active editor: stay silent
			return Promise.reject("No open file editor.");
		}

		let symbol = SymbolHelper.AnalyzeSelection(document, position);

		if(symbol.Type !== SymbolType.MethodInvocation){
			return Promise.reject("Unsupported symbol.");
		}
		
		let documentationMarkdown = this.GetDocumentationFromDocumentingHeader(symbol);

		if(documentationMarkdown.value === ""){
			return Promise.resolve(new vscode.Hover("No documenting header found for method '"+symbol.Name+"'"));
		}else{
			return Promise.resolve(new vscode.Hover(documentationMarkdown));
		}		
    }
}