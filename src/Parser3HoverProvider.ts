'use strict';

import * as vscode from 'vscode';
import { Parser3Index, FileInfo } from './Parser3Index';
import { Parser3DefinitionProvider } from './Parser3DefinitionProvider';
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

	constructor(private index: Parser3Index, private definitions: Parser3DefinitionProvider) { }


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

	private async ReadText(info: FileInfo, document: vscode.TextDocument): Promise<string> {
		if (info.uri.fsPath === document.uri.fsPath) {
			return document.getText();
		}
		let open = vscode.workspace.textDocuments.find(d => d.uri.fsPath === info.uri.fsPath);
		if (open) {
			return open.getText();
		}
		try {
			let bytes = await vscode.workspace.fs.readFile(info.uri);
			return Buffer.from(bytes).toString("utf8");
		} catch (e) {
			return "";
		}
	}

	private async BuildHover(location: vscode.Location, document: vscode.TextDocument): Promise<vscode.MarkdownString | undefined> {
		let info = this.index.getFile(location.uri);
		if (!info) {
			return undefined;
		}
		let line = location.range.start.line;
		let text = await this.ReadText(info, document);
		let lines = text.split(/\r?\n/);
		let declaration = (lines[line] || "").trim();
		if (declaration === "") {
			return undefined;
		}

		let md = new vscode.MarkdownString();
		if (info.classLine === line) {
			declaration = "@CLASS " + info.className + (info.baseName ? " : " + info.baseName : "");
		}
		md.appendCodeblock(declaration, "parser3ext");

		let where = vscode.workspace.asRelativePath(info.uri) + ":" + (line + 1);
		md.appendMarkdown((info.className && info.classLine !== line ? "`" + info.className + "` · " : "") + where);

		if (info.classLine !== line) {
			let offset = lines.slice(0, line).reduce((sum, l) => sum + l.length + 1, 0);
			let header = this.GetDocumentingHeader(text, offset);
			if (header) {
				md.appendMarkdown("\n\n---\n\n");
				md.appendMarkdown(new MarkdownBuilder().BuildMarkdown(header).value);
			}
		}
		return md;
	}

	public async provideHover(
		document: vscode.TextDocument,
		position: vscode.Position,
		token: vscode.CancellationToken): Promise<vscode.Hover | undefined> {

		if (!this.index.isReady) {
			return undefined;
		}
		let locations = this.definitions.resolve(document, position);
		if (locations.length === 0 || token.isCancellationRequested) {
			return undefined;
		}

		let parts: vscode.MarkdownString[] = [];
		for (let location of locations.slice(0, 5)) {
			let md = await this.BuildHover(location, document);
			if (md) {
				parts.push(md);
			}
		}
		if (locations.length > 5) {
			parts.push(new vscode.MarkdownString("… " + (locations.length - 5) + " more"));
		}
		return parts.length > 0 ? new vscode.Hover(parts) : undefined;
	}
}
