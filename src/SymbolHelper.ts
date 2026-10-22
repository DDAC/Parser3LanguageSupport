'use strict';

import * as vscode from 'vscode';

export class SymbolType {
	public static MethodDeclaration : string = "MethodDeclaration";
	public static MethodInvocation : string = "MethodInvocation";
	public static Variable : string = "Variable";
	public static ConstructorInvocation : string = "ConstructorInvocation";
	public static MemberAccess : string = "MemberAccess";
	public static StaticMethodInvocation : string = "StaticMethodInvocation";
	public static MethodParameterDeclaration : string = "MethodParameterDeclaration";
	public static Comment : string = "Comment";
	public static Directive : string = "Directive";
	public static Unknown : string = "UNKNOWN";
}

export class Symbol{
	Type: string;
	Name : string;
	ClearName : string;
	ContainingString : string;
	Document : vscode.TextDocument;
	Position : vscode.Position;
	HasSelfAccess : boolean;
	
	constructor(symbolType : string, symbolName : string, containingString : string, document : vscode.TextDocument, position : vscode.Position){
		this.Type = symbolType;
		this.Name = symbolName;
		this.ContainingString = containingString;
		this.Position = position;
		this.Document = document;		
		this.HasSelfAccess = symbolName.startsWith("self.");
		if(this.HasSelfAccess){
			this.ClearName = this.Name.substr("self.".length);
		}else{
			this.ClearName = this.Name;
		}
	}

	public static Unknown(memberName : string, containingString : string, document : vscode.TextDocument, position : vscode.Position):Symbol{
		return new Symbol(SymbolType.Unknown, memberName, containingString, document, position);
	}

	public static Method(methodName : string, containingString : string, isInvocation : boolean, document : vscode.TextDocument, position : vscode.Position){
		return isInvocation 
			? new Symbol(SymbolType.MethodInvocation, methodName, containingString, document, position)
			: new Symbol(SymbolType.MethodDeclaration, methodName, containingString, document, position);
	}

	public static Constructor(constructorMethodName : string, containingString : string, document : vscode.TextDocument, position : vscode.Position){
		return new Symbol(SymbolType.ConstructorInvocation, constructorMethodName, containingString, document, position);
	}

	public static Variable(variableName : string, containingString : string, document : vscode.TextDocument, position : vscode.Position){
		return new Symbol(SymbolType.Variable,variableName, containingString, document, position);
	}

	public static MemberAccess(memberName : string, containingString : string, document : vscode.TextDocument, position : vscode.Position){
		return new Symbol(SymbolType.MemberAccess, memberName, containingString, document, position);
	}

	public static StaticMethodInvocation(methodName : string, containingString : string, document : vscode.TextDocument, position : vscode.Position){
		return new Symbol(SymbolType.StaticMethodInvocation, methodName, containingString, document, position);
	}

	public static MethodParameterDeclaration(parameterName : string, containingString : string, document : vscode.TextDocument, position : vscode.Position){
		return new Symbol(SymbolType.MethodParameterDeclaration, parameterName, containingString, document, position);
	}

	public static Comment(containingString : string, document : vscode.TextDocument, position : vscode.Position){
		return new Symbol(SymbolType.Comment, "Comment", containingString, document, position);
	}

	public static Directive(directiveName : string, containingString : string, document : vscode.TextDocument, position : vscode.Position){
		return new Symbol(SymbolType.Directive, directiveName, containingString, document, position);
	}
	
	public GetNormalizedName() : string {
		let ret = this.ClearName.substr("@".length).toLowerCase();
		while(ret.charAt(0) === "_"){
			ret = ret.substr(1);
		}
		return ret;
	}
}

export class SymbolHelper{

	public static readonly AutoMethodDeclaration = "@auto[]";
	public static readonly PostprocessMethodDeclaration = "@postprocess[]";
	public static readonly UnhandledExceptionMethodDeclaration = "@unhandled_exception[]";

	public static AnalyzeSelection(document: vscode.TextDocument, position: vscode.Position) : Symbol{
		let currentString = document.lineAt(position.line).text.trim();

		if(currentString.charAt(0) === "#"){
			return Symbol.Comment(currentString, document, position);
		}

		let wordRange = document.getWordRangeAtPosition(position);
		if(wordRange === undefined){
			if(position.character===0){
				// means cursor is at the start of the string
				wordRange = document.lineAt(position.line).range;
			}else{
				return Symbol.Unknown("", currentString, document, position);	
			}
		}

		let word = document.getText(wordRange);
		let wordRangeWithLeadingSymbol;
		if(wordRange.start.character === 0){
			wordRangeWithLeadingSymbol = wordRange;
		}else{
			wordRangeWithLeadingSymbol = new vscode.Range(wordRange.start.translate(0,-1), wordRange.end);
		}
		
		let wordWithLeadingSymbol = document.getText(wordRangeWithLeadingSymbol);

		// analyze $self. of ^.self prefix
		if(wordRange.start.character >= "^self.".length){
			let potentialSelfAccessRange = new vscode.Range(wordRange.start.translate(0,-("^self.".length)), wordRange.end);
			let potentialSelfAccess = document.getText(potentialSelfAccessRange);
			if(potentialSelfAccess.indexOf("^self.") !== -1 || potentialSelfAccess.indexOf("@self.") !== -1){
				word = potentialSelfAccess.substr(1);
				wordWithLeadingSymbol = potentialSelfAccess;
			}
		}		

		switch(wordWithLeadingSymbol.substr(0,1)){
			case "$":
				return Symbol.Variable(word, currentString, document, position);
			case "^":
				return Symbol.Method(word, currentString, true, document, position);
			case "@":
				if(wordWithLeadingSymbol.indexOf("[") !== -1 
					&& wordWithLeadingSymbol.indexOf("]") !== -1){
					return Symbol.Method(word, currentString, false, document, position);
				}else{
					return Symbol.Directive(word, currentString, document, position);
				}
			case ":":
				let wordRangeWithTwoLeadingSymbols = new vscode.Range(wordRange.start.translate(0,-2), wordRange.end);
				let wordWithTwoLeadingSymbols = document.getText(wordRangeWithTwoLeadingSymbols);
				if(wordWithTwoLeadingSymbols.startsWith("::")){
					return Symbol.Constructor(word, currentString, document, position);
				}else{
					return Symbol.StaticMethodInvocation(word, currentString, document, position);
				}
			case ".":
				return Symbol.MemberAccess(word, currentString, document, position);						
			case "[":
				return Symbol.MethodParameterDeclaration(word, currentString, document, position);
			case " ":	
			default:
				return Symbol.Unknown(word, currentString, document, position);
		}
	}

	public static GetMethodDeclarations(document: vscode.TextDocument) : Symbol[]{
		let ret = new Array<Symbol>();

		for(let i= 0 ; i<document.lineCount; i++){
			let line = document.lineAt(i);
			let symbol = this.AnalyzeSelection(document, line.range.start);
			if(symbol.Type === SymbolType.MethodDeclaration){
				ret.push(symbol);
			}
		}
		return ret;
	}

	public static IsPostprocessMethod(symbol : Symbol) : boolean{
		return symbol.Name.startsWith(this.PostprocessMethodDeclaration);
	}

	public static IsAutoMethod(symbol : Symbol) : boolean{
		return symbol.Name.startsWith(this.AutoMethodDeclaration);
	}

	public static IsUnhandledExceptionMethod(symbol : Symbol) : boolean{
		return symbol.Name.startsWith(this.UnhandledExceptionMethodDeclaration);
	}
}