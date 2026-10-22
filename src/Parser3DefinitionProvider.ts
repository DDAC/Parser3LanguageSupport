'use strict';

import * as vscode from 'vscode';
import * as path from 'path';
import { Parser3Index, FileInfo, MethodMatch } from './Parser3Index';

const WORD_RE = /[A-Za-z_][\w]*/;

export class Parser3DefinitionProvider implements vscode.DefinitionProvider {

	constructor(private index: Parser3Index) { }

	public async provideDefinition(
		document: vscode.TextDocument,
		position: vscode.Position,
		token: vscode.CancellationToken): Promise<vscode.Location[]> {

		await this.index.ensureBuilt();
		if (token.isCancellationRequested) {
			return [];
		}
		return this.resolve(document, position);
	}

	/** Shared by the definition and hover providers. */
	public resolve(document: vscode.TextDocument, position: vscode.Position): vscode.Location[] {

		let lineText = document.lineAt(position.line).text;
		if (lineText.trim().startsWith("#")) {
			return [];
		}

		// ^use[path] / ^include[path] : jump to the file
		let fileTarget = this.resolveFileReference(lineText, position.character);
		if (fileTarget) {
			return fileTarget;
		}

		let range = document.getWordRangeAtPosition(position, WORD_RE);
		if (!range) {
			return [];
		}
		let word = document.getText(range);
		let before = lineText.substring(0, range.start.character);
		let after = lineText.substring(range.end.character);

		let current = this.index.updateFromDocument(document);

		// class name on the line after @CLASS / @BASE, or inside ^mixin[...]
		if (this.isClassNameLine(document, position.line) || /\^mixin\[\s*$/.test(before)) {
			return this.classLocations(word);
		}

		// ^Class:method, ^Class::create, $Class:CONST — cursor on the method part
		let classPrefix = /([A-Za-z_]\w*)(::?)$/.exec(before);
		if (classPrefix) {
			return this.resolveClassMember(current, classPrefix[1], word, classPrefix[2] === "::");
		}

		// ^self.method, $self.prop, ^BASE.method, ^obj.method
		let dotPrefix = /(\$|\^)?([A-Za-z_]\w*)\.$/.exec(before);
		if (dotPrefix) {
			return this.resolveDotMember(current, dotPrefix[2], word);
		}

		// cursor on the class name: ^Class:..., $Class:..., ^Class::create
		if (/^::?/.test(after) && /[\^$\[;(\s]$/.test(before)) {
			let classLocs = this.classLocations(word);
			if (classLocs.length > 0) {
				return classLocs;
			}
		}

		// ^method[...] without a prefix: own class chain, then global helpers, then everywhere
		if (/\^$/.test(before)) {
			let chain = this.index.resolveChain(current);
			let found = this.index.findMethodInChain(chain, word, false);
			if (found.length === 0) {
				found = this.index.findGlobalMethod(word);
			}
			if (found.length === 0 && !this.index.ignoredMethods.has(word)) {
				found = this.index.findMethodEverywhere(word);
			}
			return this.toLocations(found);
		}

		// anything that looks like a class name (strings, ^reflection:class_by_name[...], @USE lines)
		if (/^[A-Z]/.test(word)) {
			return this.classLocations(word);
		}

		return [];
	}

	// ------------------------------------------------------------------ helpers

	private isClassNameLine(document: vscode.TextDocument, line: number): boolean {
		for (let i = line - 1; i >= 0 && i >= line - 5; i--) {
			let text = document.lineAt(i).text.trim();
			if (text === "") {
				continue;
			}
			return text === "@CLASS" || text === "@BASE";
		}
		return false;
	}

	private resolveFileReference(lineText: string, character: number): vscode.Location[] | undefined {
		let re = /\^(use|include)\[\s*([^\]\s]+)\s*\]/g;
		let m: RegExpExecArray | null;
		while ((m = re.exec(lineText)) !== null) {
			let start = m.index + m[0].indexOf(m[2]);
			let end = start + m[2].length;
			if (character < start || character > end) {
				continue;
			}
			let ref = m[2];
			if (ref.indexOf("$") !== -1) {
				return [];
			}
			let result: vscode.Location[] = [];
			let folders = vscode.workspace.workspaceFolders || [];
			folders.forEach(f => {
				let abs = vscode.Uri.file(path.join(f.uri.fsPath, ref));
				let known = this.index.getFile(abs);
				if (known) {
					result.push(new vscode.Location(known.uri, new vscode.Position(0, 0)));
				}
			});
			if (result.length === 0) {
				result = this.index.findByBasename(ref).map(f => new vscode.Location(f.uri, new vscode.Position(0, 0)));
			}
			return result;
		}
		return undefined;
	}

	private classLocations(className: string): vscode.Location[] {
		return this.index.findClass(className).map(f => {
			let line = f.classLine !== undefined ? f.classLine : 0;
			return new vscode.Location(f.uri, new vscode.Position(line, 0));
		});
	}

	private resolveClassMember(current: FileInfo, className: string, member: string, isConstructor: boolean): vscode.Location[] {
		let chain: FileInfo[];
		if (className === "BASE") {
			chain = this.index.resolveBaseChain(current);
		} else if (className === "self") {
			chain = this.index.resolveChain(current);
		} else {
			let classes = this.index.findClass(className);
			if (classes.length === 0) {
				return [];
			}
			chain = [];
			classes.forEach(c => this.index.resolveChain(c).forEach(f => chain.push(f)));
		}

		let found = this.index.findMethodInChain(chain, member, true);
		if (found.length === 0) {
			for (let f of chain) {
				let st = f.statics.get(member);
				if (st !== undefined) {
					found.push({ file: f, line: st });
					break;
				}
			}
		}
		if (found.length > 0) {
			return this.toLocations(found);
		}
		if (isConstructor || className !== "BASE") {
			// no such method: at least open the class
			return chain.length > 0 ? this.toLocations([{ file: chain[0], line: chain[0].classLine || 0 }]) : [];
		}
		return [];
	}

	private resolveDotMember(current: FileInfo, owner: string, member: string): vscode.Location[] {
		if (owner === "self") {
			let found = this.index.findMethodInChain(this.index.resolveChain(current), member, true);
			return this.toLocations(found);
		}
		if (owner === "BASE") {
			let found = this.index.findMethodInChain(this.index.resolveBaseChain(current), member, true);
			return this.toLocations(found);
		}
		if (this.index.ignoredMethods.has(member)) {
			return [];
		}
		// unknown receiver type: every declaration with that name, own class first
		let own = this.index.findMethodInChain(this.index.resolveChain(current), member, true);
		let all = this.index.findMethodEverywhere(member);
		let getters = this.index.allFiles
			.filter(f => f.getters.has(member))
			.map(f => <MethodMatch>{ file: f, line: f.getters.get(member) });
		return this.toLocations(this.unique(own.concat(all, getters)));
	}

	private unique(list: MethodMatch[]): MethodMatch[] {
		let seen = new Set<string>();
		return list.filter(m => {
			let key = m.file.uri.fsPath + ":" + m.line;
			if (seen.has(key)) {
				return false;
			}
			seen.add(key);
			return true;
		});
	}

	private toLocations(list: MethodMatch[]): vscode.Location[] {
		return list.map(m => new vscode.Location(m.file.uri, new vscode.Position(m.line, 0)));
	}
}
