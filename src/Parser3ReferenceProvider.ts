'use strict';

import * as vscode from 'vscode';
import { Parser3Index, FileInfo } from './Parser3Index';
import { Parser3DefinitionProvider } from './Parser3DefinitionProvider';

const WORD_RE = /[A-Za-z_][\w]*/;

interface Target {
	kind: "method" | "getter" | "static" | "class";
	name: string;
	/** file that declares the method/getter/static */
	owner?: FileInfo;
	ownerLine?: number;
}

export class Parser3ReferenceProvider implements vscode.ReferenceProvider, vscode.DocumentHighlightProvider {

	constructor(private index: Parser3Index, private definitions: Parser3DefinitionProvider) { }

	public async provideReferences(
		document: vscode.TextDocument,
		position: vscode.Position,
		context: vscode.ReferenceContext,
		token: vscode.CancellationToken): Promise<vscode.Location[]> {

		await this.index.ensureBuilt();
		if (token.isCancellationRequested) {
			return [];
		}
		return this.findReferences(document, position, context.includeDeclaration);
	}

	public async provideDocumentHighlights(
		document: vscode.TextDocument,
		position: vscode.Position): Promise<vscode.DocumentHighlight[]> {

		if (!this.index.isReady) {
			return [];
		}
		let refs = this.findReferences(document, position, true);
		return refs
			.filter(l => l.uri.fsPath === document.uri.fsPath)
			.map(l => new vscode.DocumentHighlight(l.range, vscode.DocumentHighlightKind.Read));
	}

	// ------------------------------------------------------------------ core

	public findReferences(document: vscode.TextDocument, position: vscode.Position, includeDeclaration: boolean): vscode.Location[] {
		let lineText = document.lineAt(position.line).text;
		if (lineText.trim().startsWith("#")) {
			return [];
		}
		let range = document.getWordRangeAtPosition(position, WORD_RE);
		if (!range) {
			return [];
		}
		let word = document.getText(range);
		let before = lineText.substring(0, range.start.character);
		let after = lineText.substring(range.end.character);
		let current = this.index.updateFromDocument(document);

		let targets = this.targetsAtCursor(document, position, current, word, before, after);
		if (targets.length > 0) {
			let result: vscode.Location[] = [];
			targets.forEach(t => this.referencesOf(t, includeDeclaration).forEach(l => result.push(l)));
			return this.unique(result);
		}

		if (this.looksLikeLocalVariable(word, before, after)) {
			return this.localVariableReferences(document, position.line, word);
		}
		return [];
	}

	private targetsAtCursor(document: vscode.TextDocument, position: vscode.Position, current: FileInfo, word: string, before: string, after: string): Target[] {
		// cursor on a declaration: @name[ / @static:name[ / @GET_x[
		if (/@(static:)?$/.test(before)) {
			return this.targetsFromDeclaration(current, word, position.line);
		}

		// class-level static assignment at column 0: $NAME[...]
		if (before === "$" && /^\s*[\[(]/.test(after) && current.statics.get(word) === position.line) {
			return [{ kind: "static", name: word, owner: current, ownerLine: position.line }];
		}

		// a plain local variable is never a project-wide target
		if (this.looksLikeLocalVariable(word, before, after)) {
			return [];
		}

		// everything else: whatever Go to Definition resolves to
		let locations = this.definitions.resolve(document, position);
		let targets: Target[] = [];
		locations.forEach(loc => {
			let info = this.index.getFile(loc.uri);
			if (!info) {
				return;
			}
			let line = loc.range.start.line;
			if (info.classLine === line && info.className) {
				targets.push({ kind: "class", name: info.className, owner: info, ownerLine: line });
				return;
			}
			let method = info.methods.find(m => m.line === line);
			if (method) {
				this.targetsFromDeclaration(info, method.name, line).forEach(t => targets.push(t));
				return;
			}
			for (let [name, l] of info.statics) {
				if (l === line) {
					targets.push({ kind: "static", name: name, owner: info, ownerLine: line });
					return;
				}
			}
		});
		return targets;
	}

	private targetsFromDeclaration(owner: FileInfo, methodName: string, line: number): Target[] {
		let targets: Target[] = [{ kind: "method", name: methodName, owner: owner, ownerLine: line }];
		if (methodName.startsWith("GET_") || methodName.startsWith("SET_")) {
			targets.push({ kind: "getter", name: methodName.substr(4), owner: owner, ownerLine: line });
		}
		return targets;
	}

	private looksLikeLocalVariable(word: string, before: string, after: string): boolean {
		if (word === "self" || word === "BASE" || /^[A-Z]/.test(word)) {
			return false;
		}
		if (/^::?/.test(after)) {
			return false; // class
		}
		if (/\$$/.test(before)) {
			return true; // $var, $var.x, $var[...]
		}
		if (/\^$/.test(before) && /^\./.test(after)) {
			return true; // ^var.method[...]
		}
		if (/^@(static:)?[A-Za-z_]\w*\s*\[/.test(before) && /[\[;]$/.test(before) && /^\s*[;\]]/.test(after)) {
			return true; // parameter or local in the declaration brackets
		}
		return false;
	}

	// ------------------------------------------------------------- references

	private referencesOf(target: Target, includeDeclaration: boolean): vscode.Location[] {
		let result: vscode.Location[] = [];
		let declaration: vscode.Location | undefined;
		if (includeDeclaration && target.owner && target.ownerLine !== undefined) {
			let declText = target.kind === "class" ? target.name : (target.kind === "static" ? "$" + target.name : "@" + target.name);
			declaration = this.location(target.owner, target.ownerLine, 0, declText.length);
		}

		if (target.kind === "class") {
			return (declaration ? [declaration] : []).concat(this.classReferences(target.name));
		}

		let owner = target.owner as FileInfo;
		let chains = new Map<string, FileInfo[]>();
		let chainOf = (f: FileInfo) => {
			let c = chains.get(f.uri.fsPath);
			if (!c) {
				c = this.index.resolveChain(f);
				chains.set(f.uri.fsPath, c);
			}
			return c;
		};
		let resolvesToOwner = (chain: FileInfo[]) => {
			if (target.kind === "static") {
				return chain.some(f => f.uri.fsPath === owner.uri.fsPath);
			}
			let found = this.index.findMethodInChain(chain, target.name, target.kind === "getter");
			if (found.length === 0) {
				return !owner.className; // global helper: any unresolved call may hit it
			}
			return found.some(m => m.file.uri.fsPath === owner.uri.fsPath && (target.kind === "getter" || m.line === target.ownerLine));
		};

		this.index.findCalls(target.name).forEach(cm => {
			let c = cm.call;
			let accept = false;
			switch (c.receiver) {
				case "none":
					accept = target.kind === "method" && c.sigil === "^" && resolvesToOwner(chainOf(cm.file));
					break;
				case "self":
					accept = resolvesToOwner(chainOf(cm.file));
					break;
				case "BASE":
					accept = resolvesToOwner(this.index.resolveBaseChain(cm.file));
					break;
				case "class": {
					let classes = this.index.findClass(c.receiverClass as string);
					let chain: FileInfo[] = [];
					classes.forEach(k => chainOf(k).forEach(f => chain.push(f)));
					accept = classes.length > 0 && resolvesToOwner(chain);
					break;
				}
				case "var":
					accept = true; // receiver type unknown: possible reference
					break;
			}
			if (accept) {
				result.push(this.location(cm.file, c.line, c.character, c.name.length));
			}
		});
		// a `$self.NAME[...]` assignment is already listed as a call on the same line
		if (declaration && !result.some(l => l.uri.fsPath === declaration!.uri.fsPath && l.range.start.line === declaration!.range.start.line)) {
			result.unshift(declaration);
		}
		return result;
	}

	private classReferences(className: string): vscode.Location[] {
		let result: vscode.Location[] = [];
		let key = className.toLowerCase();
		this.index.allFiles.forEach(f => {
			if (f.baseName && f.baseName.toLowerCase() === key && f.baseLine !== undefined) {
				result.push(this.location(f, f.baseLine, 0, f.baseName.length));
			}
			f.mixins.forEach(m => {
				if (m.name.toLowerCase() === key) {
					result.push(this.location(f, m.line, m.character, m.name.length));
				}
			});
			f.calls.forEach(c => {
				if (c.receiver === "class" && c.receiverClass && c.receiverClass.toLowerCase() === key && c.receiverCharacter !== undefined) {
					result.push(this.location(f, c.line, c.receiverCharacter, c.receiverClass.length));
				}
			});
		});
		return result;
	}

	private localVariableReferences(document: vscode.TextDocument, line: number, name: string): vscode.Location[] {
		let start = line;
		while (start > 0 && !/^@/.test(document.lineAt(start).text)) {
			start--;
		}
		let end = line + 1;
		while (end < document.lineCount && !/^@/.test(document.lineAt(end).text)) {
			end++;
		}
		let result: vscode.Location[] = [];
		let escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		let useRe = new RegExp("[\\^$]" + escaped + "(?![\\w])", "g");
		let declRe = new RegExp("(?<=[\\[;])" + escaped + "(?=\\s*[;\\]])", "g");
		for (let i = start; i < end; i++) {
			let text = document.lineAt(i).text;
			if (text.trim().startsWith("#")) {
				continue;
			}
			let re = i === start && /^@/.test(text) ? declRe : useRe;
			let offset = re === useRe ? 1 : 0;
			let m: RegExpExecArray | null;
			re.lastIndex = 0;
			while ((m = re.exec(text)) !== null) {
				result.push(new vscode.Location(document.uri, new vscode.Range(i, m.index + offset, i, m.index + offset + name.length)));
			}
		}
		return result;
	}

	// ---------------------------------------------------------------- helpers

	private location(info: FileInfo, line: number, character: number, length: number): vscode.Location {
		return new vscode.Location(info.uri, new vscode.Range(line, character, line, character + length));
	}

	private unique(list: vscode.Location[]): vscode.Location[] {
		let seen = new Set<string>();
		return list.filter(l => {
			let key = l.uri.fsPath + ":" + l.range.start.line + ":" + l.range.start.character;
			if (seen.has(key)) {
				return false;
			}
			seen.add(key);
			return true;
		});
	}
}

