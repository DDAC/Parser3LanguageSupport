'use strict';

import * as vscode from 'vscode';
import { Parser3Index, parseText, FileInfo } from './Parser3Index';

export class Parser3DocumentSymbolProvider implements vscode.DocumentSymbolProvider {

	public provideDocumentSymbols(document: vscode.TextDocument): vscode.DocumentSymbol[] {
		let info = parseText(document.uri, document.getText());
		let methods = info.methods.map(m => {
			let range = document.lineAt(m.line).range;
			let kind = m.isStatic ? vscode.SymbolKind.Function : vscode.SymbolKind.Method;
			if (m.name.startsWith("GET_") || m.name.startsWith("SET_")) {
				kind = vscode.SymbolKind.Property;
			}
			return new vscode.DocumentSymbol(m.name, m.isStatic ? "static" : "", kind, range, range);
		});

		if (!info.className || info.classLine === undefined) {
			return methods;
		}

		let fullRange = new vscode.Range(0, 0, document.lineCount - 1, 0);
		let classSymbol = new vscode.DocumentSymbol(
			info.className,
			info.baseName ? ": " + info.baseName : "",
			vscode.SymbolKind.Class,
			fullRange,
			document.lineAt(info.classLine).range);
		classSymbol.children = methods;
		return [classSymbol];
	}
}

export class Parser3WorkspaceSymbolProvider implements vscode.WorkspaceSymbolProvider {

	constructor(private index: Parser3Index) { }

	public async provideWorkspaceSymbols(query: string): Promise<vscode.SymbolInformation[]> {
		await this.index.ensureBuilt();
		let result: vscode.SymbolInformation[] = [];

		this.index.searchClasses(query).forEach(f => {
			result.push(this.classSymbol(f));
		});
		this.index.searchMethods(query, 500).forEach(m => {
			let method = m.file.methods.find(x => x.line === m.line);
			let name = method ? method.name : query;
			result.push(new vscode.SymbolInformation(
				name,
				vscode.SymbolKind.Method,
				m.file.className || "",
				new vscode.Location(m.file.uri, new vscode.Position(m.line, 0))));
		});
		return result;
	}

	private classSymbol(f: FileInfo): vscode.SymbolInformation {
		return new vscode.SymbolInformation(
			f.className || "",
			vscode.SymbolKind.Class,
			"",
			new vscode.Location(f.uri, new vscode.Position(f.classLine || 0, 0)));
	}
}
