# Parser 3 Language Support extension

Fork of [T-Soft/Parser3LanguageSupport](https://github.com/T-Soft/Parser3LanguageSupport) by Tony Skorik (MIT), maintained by DAC. Adds project-wide code navigation.

![](.\images\logo.png)

This extension adds Parser3 language support to VSCode.

## Features

- Syntax highlighting (mixed Parser3, HTML, SQL).

- **Go to Definition** (`F12`, `Cmd`/`Ctrl`+click) across the whole workspace: `^Class:method`, `^Class::create`, `$Class:CONST`, `^self.method`, `$self.property` (`@GET_property`), `^BASE:method`, `^method[]` of the own class or global helpers, class names after `@CLASS` / `@BASE` / `^mixin[]`, file paths in `^use[]` / `^include[]`. Calls on untyped variables (`^obj.method[]`) show every declaration with that name. Inheritance (`@BASE`), partial classes and mixins are followed.

- **Find All References** (`Shift+F12`) and occurrence highlighting: calls of a method through `^self.`, `^Class:`, `^BASE:` and unprefixed `^method[]` are matched through the inheritance chain, calls on untyped variables are listed as possible references; class references (`@BASE`, `^mixin[]`, `^Class:`), class fields and constants (`$Class:NAME`), and local variables within a method body. Rename is intentionally not provided.

- **Symbols**: outline, breadcrumbs, `Go to Symbol in Editor` and `Go to Symbol in Workspace` list classes and methods.

- C# - style documenting header insertions.

- Hover on a method or class shows its signature, class and file location (resolved like Go to Definition), plus the documenting header when one is present.

- Comment / Uncomment selection commands (both `#` and `^rem{}`) with configurable suffixes.

- Go to specified method declaration within one file. Featuring special methods list sorting and some special labels such as file start and file end.

- `Cmd+/` / `Ctrl+/` toggles line comments with `#` at column 0 (Parser3 ignores indented markers); honours `parser3ext.settings.commentSymbolSuffix`.

- Comment-aware tabulation. Overrides default `TAB` key bahavior via contributed keybinding.

## Requirements

VSCode 1.25.0 and higher.

## Getting Started

1. Install the extension
2. Restart VS Code and open the folder containing the project you want to work on.

## Extension Settings

This extension contributes the following settings:

* `parser3ext.navigation.include`: glob of files indexed for navigation (default `**/*.{p,bp,pp}`).
* `parser3ext.navigation.exclude`: glob of files excluded from the index.
* `parser3ext.navigation.ignoredMethods`: Parser3 built-in method names never searched across the project when the receiver type is unknown.

* `parser3ext.settings.forceCursorOnTheLineStart`: Move the cursor on the line start upon InsertDocumentingHeader invocation. If set to `false` and invoked - the warning will be displayed and nothing happens.
* `parser3ext.settings.allowedEmptyLinesCount`: Amount of empty lines between method signature and documenting comment start. If exceeded documenting header won't be parsed into hover.
* `parser3ext.settings.disableGoToMethodListSorting`: Set to `true` to diasable method signatures sorting in GoToMethod picker.
* `parser3ext.settings.commentSymbolSuffix`: Sets the symbol which should be printed after comment `#` symbol upon `parser3ext.commentSelection` command invocation.

## Known Issues

- Mixed language (SQL + XML + Parser3) syntax highlighting sometimes works incorrectly (see `syntax highlight` issues).

If you find any bugs or whant to request a feature - feel free to submit an issue or a pull request.

## Building

```
npm install
npm run compile
npx vsce package
code --install-extension parser3-language-support-<version>.vsix
```

## Release Notes

### 1.6.2

- Grammar: method names in call chains (`^self.method`, `^Class:method`, `^obj.a.b`) are scoped `entity.name.function`, accessors `punctuation.accessor`, declaration parameters `variable.parameter`.
- Note: the bare "Visual Studio Dark" / "Visual Studio Light" themes do not colour functions and variables; use Dark+/Dark Modern or add `editor.tokenColorCustomizations` for the `*.parser3ext` scopes.

### 1.6.1

- `Cmd+/` / `Ctrl+/` in Parser3 files toggles `#` at column 0 instead of the indentation level.

### 1.6.0

- Find All References and occurrence highlighting for methods, getters, class fields, classes and local variables.
- Go to Definition resolves `$Class:NAME` fields to their first assignment.

### 1.5.1

- Hover shows the method signature, class and file:line for the resolved declaration (including methods from other files and base classes); the "No documenting header found" message is gone.

### 1.5.0

- Fork by DAC: publisher changed to `DAC`.
- Added Go to Definition across the workspace (classes, methods, getters, inheritance, mixins, `^use`/`^include`).
- Added document and workspace symbol providers (outline, breadcrumbs, Go to Symbol).
- Added command `Parser3: Rebuild navigation index`.
- Hover no longer shows the "Open a file first to go to definition" popup in diff and peek views.
- Build moved to `@types/vscode` + TypeScript 5, stub tests removed.


### 1.3.1

- Added `region`, `endregion` and `wrapreg` snippets and `ctrl+k ctrl+r` shortcut for wrapping selected text in folding region markers

### 1.3.0

- Switched to json grammar
- Added `@static:` method prefix syntax highlighting
- Added `#region <RegionName> ... #endregion` folding constructs

### 1.2.0

- Refactored comments and methods search logic

### 1.1.9

- RemSelection command now inserts suffix after `^rem{`. Suffix can be configured in `parser3ext.settings.remCommentSuffix`.
- GoToMethod now supports multiple methods with the same name.

### 1.1.8

- CommentSelection command now does not insert `parser3ext.settings.commentSymbolSuffix` if invoked for already commented line.

### 1.1.7

- Fixed error when comment-aware TAB did not work if the cursor was in first position of an empty line.
- Content-aware TAB now ignores last selection line if it has no symbols selected (cursor is at the beginning of a line).

### 1.1.6

- Added setting `allowCommentAwareTabCommentsShift` to allow comment-awatre TAB to shift commented strings. Default is `false`.
- Last string of selection now does not get shifted if it has no symbols selected.

### 1.1.5

- Added command to wrap selection in `^rem{}`.
- TAB is now comment-aware. I.e. if the line starts with the comment symbol `#` it will be left at the begginning of the line and TAB chacracter will be inserted after it.
- Fixed #10 : wrong comment selection translation.

### 1.1.3

- Changed xmldoc building logic.
- Fixed GoToMethod sorting logic.
- GoToMethod sorting logic now puts `unhandled_excepton` method at the end of the list.
- CommentSelection now does not comment the last selection line if cursor stands at its beginning.

### 1.1.2

- In addition to method sorting, added `auto` and `postprocess` methods to top and bottom of the list respectively.
- Documenting header popup now has parameters separated from other sections.
- Reformated documenting header popup.

### 1.1.1

- Method decalrations are now lexicographically sorted (it is possible to switch sorting off in settings).
- Added end of file option in GoToMethod command.

### 1.1.0

- Documenting header popup is now multi-lined.
- Added command to go to method declaration in currently opened file.

### 1.0.1

- Updated packages

### 1.0.0

- First public release