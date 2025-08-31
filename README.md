# Doc Helper (Track 3, Problem Statement 1)

This is a Visual Studio Code extension prototype to solve the CodeNection Hackathon's track 3 and problem statement 1, **"Fix the Docs: Smarter, Faster, Maintainable Documentation for the Real World by iFAST"**. It is a smart documentation assistant/tool that improves how technical documentation is created, consumed, and maintained in evolving software environments.

## Problems Given
In real-world tech environments, documentation is a critical but broken part of the software development lifecycle.
- Writing it is slow, repetitive, and often skipped.
- Reading it is painful and time-consuming, especially for new joiners.
- Maintaining it is impractical in fast-changing systems — documentation quickly becomes outdated, misleading, or irrelevant.

This leads to onboarding delays, wasted engineering time, and avoidable bugs — all due to poor or outdated docs.

## Our Idea

To resolve the problems given, we had an idea of making a simple .doch directory prototype (inspired by .git from Git, the well-known version control system) to track the document status and detect stale documentation. The status will all be shown in the explorer view of Visual Studio Code, just below your workspace view for clearer look. For the smart AI-powered tools, we plan to fine-tune LLM with RAG technique to ingest the user's source code and documentation for more precise and reliable answers. 

## Features

### 1. Simplify Writing

1. Auto generate technical documentation based on the undocumented source code file.
<p align="center">
  <img alt="Explorer View" src="https://github.com/user-attachments/assets/0293c971-023f-48b3-a76e-948aeb539e3d" />
  <img alt="Generated Documentation" src="https://github.com/user-attachments/assets/b4d9f6ea-a556-4850-ab88-635b1573d863" />
</p>

> Documentation generated is based on the source code, and it can even generate flowchart!

2. 

### 2. Speed Up Reading

1. Summarize

## Requirements

If you have any requirements or dependencies, add a section describing those and how to install and configure them.

## Extension Settings

Include if your extension adds any VS Code settings through the `contributes.configuration` extension point.

For example:

This extension contributes the following settings:

* `myExtension.enable`: Enable/disable this extension.
* `myExtension.thing`: Set to `blah` to do something.

## Known Issues

Calling out known issues can help limit users opening duplicate issues against your extension.

## Release Notes

Users appreciate release notes as you update your extension.

### 1.0.0

Initial release of ...

### 1.0.1

Fixed issue #.

### 1.1.0

Added features X, Y, and Z.

---

## Following extension guidelines

Ensure that you've read through the extensions guidelines and follow the best practices for creating your extension.

* [Extension Guidelines](https://code.visualstudio.com/api/references/extension-guidelines)

## Working with Markdown

You can author your README using Visual Studio Code. Here are some useful editor keyboard shortcuts:

* Split the editor (`Cmd+\` on macOS or `Ctrl+\` on Windows and Linux).
* Toggle preview (`Shift+Cmd+V` on macOS or `Shift+Ctrl+V` on Windows and Linux).
* Press `Ctrl+Space` (Windows, Linux, macOS) to see a list of Markdown snippets.

## For more information

* [Visual Studio Code's Markdown Support](http://code.visualstudio.com/docs/languages/markdown)
* [Markdown Syntax Reference](https://help.github.com/articles/markdown-basics/)

**Enjoy!**
