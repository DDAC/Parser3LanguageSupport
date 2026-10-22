'use strict';

import * as vscode from 'vscode';
import * as path from 'path';

export interface MethodInfo {
	name: string;
	line: number;
	isStatic: boolean;
	signature: string;
}

export type Receiver = "none" | "self" | "BASE" | "class" | "var";

export interface CallInfo {
	name: string;
	line: number;
	character: number;
	sigil: "^" | "$";
	receiver: Receiver;
	receiverClass?: string;
	receiverCharacter?: number;
}

export interface MixinInfo {
	name: string;
	line: number;
	character: number;
}

export interface FileInfo {
	uri: vscode.Uri;
	className?: string;
	classLine?: number;
	baseName?: string;
	baseLine?: number;
	mixins: MixinInfo[];
	methods: MethodInfo[];
	/** property name (without GET_/SET_ prefix) -> declaration line */
	getters: Map<string, number>;
	/** first `$NAME[...]` / `$self.NAME[...]` assignment at line start -> line (class fields, constants) */
	statics: Map<string, number>;
	calls: CallInfo[];
}

export interface CallMatch {
	file: FileInfo;
	call: CallInfo;
}

export interface MethodMatch {
	file: FileInfo;
	line: number;
}

const METHOD_RE = /^@(static:)?([A-Za-z_]\w*)\s*\[/;
const MIXIN_RE = /\^mixin\[\s*([A-Za-z_]\w*)\s*\]/g;
const STATIC_RE = /^\s*\$(?:self\.)?([A-Za-z_]\w*)\s*[\[(]/;
const TOKEN_RE = /([\^$])([A-Za-z_]\w*)((?:(?:::|:|\.)[A-Za-z_]\w*)*)/g;
const SEGMENT_RE = /(::|:|\.)([A-Za-z_]\w*)/g;

function scanCalls(line: string, lineNumber: number, out: CallInfo[]) {
	let m: RegExpExecArray | null;
	TOKEN_RE.lastIndex = 0;
	while ((m = TOKEN_RE.exec(line)) !== null) {
		let sigil = m[1] as "^" | "$";
		let first = m[2];
		let firstChar = m.index + 1;
		let chain = m[3];
		if (chain === "") {
			if (sigil === "^") {
				out.push({ name: first, line: lineNumber, character: firstChar, sigil: sigil, receiver: "none" });
			}
			continue;
		}
		let pos = firstChar + first.length;
		let prevName = first;
		let prevChar = firstChar;
		let sm: RegExpExecArray | null;
		SEGMENT_RE.lastIndex = 0;
		let index = 0;
		while ((sm = SEGMENT_RE.exec(chain)) !== null) {
			let sep = sm[1];
			let name = sm[2];
			let nameChar = pos + sm.index + sep.length;
			let call: CallInfo = { name: name, line: lineNumber, character: nameChar, sigil: sigil, receiver: "var" };
			if (sep !== ".") {
				if (index === 0 && (prevName === "self" || prevName === "BASE")) {
					call.receiver = prevName;
				} else {
					call.receiver = "class";
					call.receiverClass = prevName;
					call.receiverCharacter = prevChar;
				}
			} else if (index === 0 && prevName === "self") {
				call.receiver = "self";
			} else if (index === 0 && prevName === "BASE") {
				call.receiver = "BASE";
			} else {
				call.receiver = "var";
			}
			out.push(call);
			prevName = name;
			prevChar = nameChar;
			index++;
		}
	}
}

export function parseText(uri: vscode.Uri, text: string): FileInfo {
	let info: FileInfo = { uri: uri, mixins: [], methods: [], getters: new Map<string, number>(), statics: new Map<string, number>(), calls: [] };
	let lines = text.split(/\r?\n/);
	let pending: "CLASS" | "BASE" | undefined;

	for (let i = 0; i < lines.length; i++) {
		let line = lines[i];
		let trimmed = line.trim();

		if (pending) {
			if (trimmed === "" || trimmed.startsWith("#")) {
				continue;
			}
			let name = trimmed.split(/\s+/)[0];
			if (pending === "CLASS") {
				info.className = name;
				info.classLine = i;
			} else {
				info.baseName = name;
				info.baseLine = i;
			}
			pending = undefined;
			continue;
		}

		if (trimmed === "@CLASS") {
			pending = "CLASS";
			continue;
		}
		if (trimmed === "@BASE") {
			pending = "BASE";
			continue;
		}

		let m = METHOD_RE.exec(line);
		if (m) {
			let name = m[2];
			info.methods.push({ name: name, line: i, isStatic: !!m[1], signature: trimmed });
			if (name.startsWith("GET_") || name.startsWith("SET_")) {
				let prop = name.substr(4);
				if (!info.getters.has(prop)) {
					info.getters.set(prop, i);
				}
			}
			continue;
		}

		if (trimmed.startsWith("#")) {
			continue;
		}

		let st = STATIC_RE.exec(line);
		if (st && !info.statics.has(st[1])) {
			info.statics.set(st[1], i);
		}

		if (line.indexOf("^mixin[") !== -1) {
			let mm: RegExpExecArray | null;
			MIXIN_RE.lastIndex = 0;
			while ((mm = MIXIN_RE.exec(line)) !== null) {
				info.mixins.push({ name: mm[1], line: i, character: mm.index + mm[0].indexOf(mm[1]) });
			}
		}

		scanCalls(line, i, info.calls);
	}

	return info;
}

/**
 * Framework rule (string_transform classname_to_filename): tokens are
 * [A-Z0-9]\d* followed by [a-z]*, joined by "_" when the previous token is longer than one char.
 * OrderDTO -> order_dto, Sync1cOrderJob -> sync_1c_order_job, 1cController -> 1c_controller.
 */
export function classNameToFileName(className: string): string {
	let re = /([A-Z0-9]\d*)([a-z]*)/g;
	let result = "";
	let prevLength = 0;
	let m: RegExpExecArray | null;
	while ((m = re.exec(className)) !== null) {
		let token = (m[1] + m[2]).toLowerCase();
		if (prevLength > 1) {
			result += "_";
		}
		result += token;
		prevLength = token.length;
	}
	return result;
}

export class Parser3Index {
	private _files = new Map<string, FileInfo>();
	private _classes = new Map<string, FileInfo[]>();
	private _basenames = new Map<string, FileInfo[]>();
	private _methods = new Map<string, MethodMatch[]>();
	private _calls = new Map<string, CallMatch[]>();
	private _dirty = false;
	private _building: Promise<void> | undefined;
	private _watcher: vscode.FileSystemWatcher | undefined;
	private _status: vscode.StatusBarItem;
	private _onDidChange = new vscode.EventEmitter<void>();

	public readonly onDidChange = this._onDidChange.event;

	constructor() {
		this._status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
	}

	public dispose() {
		if (this._watcher) {
			this._watcher.dispose();
		}
		this._status.dispose();
		this._onDidChange.dispose();
	}

	private get config() {
		return vscode.workspace.getConfiguration("parser3ext.navigation");
	}

	public get includeGlob(): string {
		return this.config.get<string>("include", "**/*.{p,bp,pp}");
	}

	public get excludeGlob(): string {
		return this.config.get<string>("exclude", "**/{node_modules,.git,.vscode-test}/**");
	}

	public get ignoredMethods(): Set<string> {
		return new Set<string>(this.config.get<string[]>("ignoredMethods", []));
	}

	public get isReady(): boolean {
		return this._building === undefined && this._files.size > 0;
	}

	public get fileCount(): number {
		return this._files.size;
	}

	public get allFiles(): FileInfo[] {
		return Array.from(this._files.values());
	}

	public async ensureBuilt(): Promise<void> {
		if (this._building) {
			return this._building;
		}
		if (this._files.size === 0) {
			return this.rebuild();
		}
	}

	public rebuild(): Promise<void> {
		if (this._building) {
			return this._building;
		}
		this._building = this.doRebuild().finally(() => { this._building = undefined; });
		return this._building;
	}

	private async doRebuild(): Promise<void> {
		this._status.text = "$(sync~spin) Parser3: indexing…";
		this._status.show();
		try {
			let uris = await vscode.workspace.findFiles(this.includeGlob, this.excludeGlob);
			let files = new Map<string, FileInfo>();
			for (let uri of uris) {
				let info = await this.readAndParse(uri);
				if (info) {
					files.set(uri.fsPath, info);
				}
			}
			this._files = files;
			this._dirty = true;
			this.rebuildDerived();
			this.ensureWatcher();
		} finally {
			this._status.hide();
		}
	}

	private async readAndParse(uri: vscode.Uri): Promise<FileInfo | undefined> {
		try {
			let bytes = await vscode.workspace.fs.readFile(uri);
			return parseText(uri, Buffer.from(bytes).toString("utf8"));
		} catch (e) {
			return undefined;
		}
	}

	private ensureWatcher() {
		if (this._watcher) {
			return;
		}
		this._watcher = vscode.workspace.createFileSystemWatcher(this.includeGlob);
		this._watcher.onDidCreate(uri => this.updateFile(uri));
		this._watcher.onDidChange(uri => this.updateFile(uri));
		this._watcher.onDidDelete(uri => this.removeFile(uri));
	}

	public async updateFile(uri: vscode.Uri): Promise<void> {
		let info = await this.readAndParse(uri);
		if (info) {
			this._files.set(uri.fsPath, info);
		} else {
			this._files.delete(uri.fsPath);
		}
		this._dirty = true;
		this._onDidChange.fire();
	}

	public updateFromDocument(document: vscode.TextDocument): FileInfo {
		let info = parseText(document.uri, document.getText());
		if (document.uri.scheme === "file") {
			this._files.set(document.uri.fsPath, info);
			this._dirty = true;
		}
		return info;
	}

	public removeFile(uri: vscode.Uri) {
		this._files.delete(uri.fsPath);
		this._dirty = true;
		this._onDidChange.fire();
	}

	private rebuildDerived() {
		if (!this._dirty) {
			return;
		}
		this._classes = new Map<string, FileInfo[]>();
		this._basenames = new Map<string, FileInfo[]>();
		this._methods = new Map<string, MethodMatch[]>();
		this._calls = new Map<string, CallMatch[]>();
		this._files.forEach(info => {
			if (info.className) {
				this.push(this._classes, info.className.toLowerCase(), info);
			}
			this.push(this._basenames, path.basename(info.uri.fsPath).toLowerCase(), info);
			info.methods.forEach(m => {
				this.push(this._methods, m.name, { file: info, line: m.line });
			});
			info.calls.forEach(c => {
				this.push(this._calls, c.name, { file: info, call: c });
			});
		});
		this._dirty = false;
	}

	private push<T>(map: Map<string, T[]>, key: string, value: T) {
		let list = map.get(key);
		if (!list) {
			list = [];
			map.set(key, list);
		}
		list.push(value);
	}

	// ---------------------------------------------------------------- lookups

	public getFile(uri: vscode.Uri): FileInfo | undefined {
		return this._files.get(uri.fsPath);
	}

	public findClass(className: string): FileInfo[] {
		this.rebuildDerived();
		let byName = this._classes.get(className.toLowerCase());
		if (byName && byName.length > 0) {
			return byName;
		}
		let byFile = this._basenames.get(classNameToFileName(className) + ".p");
		if (byFile && byFile.length > 0) {
			return byFile;
		}
		let byLower = this._basenames.get(className.toLowerCase() + ".p");
		return byLower ? byLower : [];
	}

	public findByBasename(fileName: string): FileInfo[] {
		this.rebuildDerived();
		let list = this._basenames.get(path.basename(fileName).toLowerCase());
		return list ? list : [];
	}

	/** File itself, its mixins and its base classes (recursively), in lookup order. */
	public resolveChain(start: FileInfo): FileInfo[] {
		let chain: FileInfo[] = [];
		let visited = new Set<string>();
		let queue: FileInfo[] = [start];
		while (queue.length > 0 && chain.length < 50) {
			let info = queue.shift() as FileInfo;
			if (visited.has(info.uri.fsPath)) {
				continue;
			}
			visited.add(info.uri.fsPath);
			chain.push(info);
			info.mixins.forEach(m => this.findClass(m.name).forEach(f => queue.push(f)));
			if (info.baseName) {
				this.findClass(info.baseName).forEach(f => queue.push(f));
			}
		}
		return chain;
	}

	/** Chain starting from the base class of the given file (for ^BASE:method). */
	public resolveBaseChain(start: FileInfo): FileInfo[] {
		if (!start.baseName) {
			return [];
		}
		let result: FileInfo[] = [];
		this.findClass(start.baseName).forEach(f => {
			this.resolveChain(f).forEach(c => result.push(c));
		});
		return result;
	}

	public findMethodInFile(info: FileInfo, name: string, withGetters: boolean): MethodMatch[] {
		let result: MethodMatch[] = [];
		info.methods.forEach(m => {
			if (m.name === name) {
				result.push({ file: info, line: m.line });
			}
		});
		if (withGetters) {
			let g = info.getters.get(name);
			if (g !== undefined) {
				result.push({ file: info, line: g });
			}
		}
		return result;
	}

	/** First file in the chain that declares the method wins (like runtime dispatch). */
	public findMethodInChain(chain: FileInfo[], name: string, withGetters: boolean): MethodMatch[] {
		for (let info of chain) {
			let found = this.findMethodInFile(info, name, withGetters);
			if (found.length > 0) {
				return found;
			}
		}
		return [];
	}

	public findCalls(name: string): CallMatch[] {
		this.rebuildDerived();
		let list = this._calls.get(name);
		return list ? list.slice() : [];
	}

	public findMethodEverywhere(name: string): MethodMatch[] {
		this.rebuildDerived();
		let list = this._methods.get(name);
		return list ? list.slice() : [];
	}

	/** Methods declared in files without @CLASS (global helpers). */
	public findGlobalMethod(name: string): MethodMatch[] {
		return this.findMethodEverywhere(name).filter(m => !m.file.className);
	}

	public searchClasses(query: string): FileInfo[] {
		this.rebuildDerived();
		let q = query.toLowerCase();
		let result: FileInfo[] = [];
		this._classes.forEach((files, key) => {
			if (key.indexOf(q) !== -1) {
				files.forEach(f => result.push(f));
			}
		});
		return result;
	}

	public searchMethods(query: string, limit: number): MethodMatch[] {
		this.rebuildDerived();
		let q = query.toLowerCase();
		let result: MethodMatch[] = [];
		for (let [name, matches] of this._methods) {
			if (name.toLowerCase().indexOf(q) !== -1) {
				for (let m of matches) {
					result.push(m);
					if (result.length >= limit) {
						return result;
					}
				}
			}
		}
		return result;
	}
}
