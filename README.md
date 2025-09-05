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

1. Auto generate technical documentation
- Using fixed template, AI automatically generates documentation based on the undocumented source code.

<p align="center">
  <img width="368" height="1020" alt="Explorer View" src="https://github.com/user-attachments/assets/4c948760-5855-4ae1-b026-9acd81258dd9" />
</p>

> The figure above shows how the dashboard looks like for the users and how they can track the files easily. The files are categorized and shown in a tree view structure. Users can easily open and close whichever file category they wanted to see.

<p align="center">
  <img alt="Generated Documentation" src="https://github.com/user-attachments/assets/b4d9f6ea-a556-4850-ab88-635b1573d863"/>
</p>

> Documentation generated is based on the source code, and it can even generate flowchart for ease-to-understand visualization! (Note: Users need to install mermaid flowchart extension named "Markdown Preview Mermaid Support" by Matt Bierner to show the flowchart directly in Visual Studio Code.)

### 2. Speed Up Reading

1. Summarize documentation (TLDR)

<img width="1916" height="1023" alt="Summarize Documentation" src="https://github.com/user-attachments/assets/b78c4b13-c8a9-435b-9ff9-87ec45fbbd84" />

> Clicking on the sparkle icon will generate summarization of the documentation briefly about what the code does, with key components and features included.

2. QnA chatbot

- We used langchain4j to implement RAG + LLM for the QnA chatbot. This ensures that the users can ask question about their source code and documentation and get their personalized answer based on the documents fed to the AI.

<p align="center">
  <img width="1157" height="1022" alt="QnA" src="https://github.com/user-attachments/assets/9af47514-5d98-42e4-85e9-4ca5097ab7f0" />
</p>

> Pressing the Document icon on the left will show our Doc Helper chatbot. Users may upload files, no matter it is the source code or documentation markdown files. The files will be ingested by embedding models and LLM model will retrieve the information and response (RAG) according to the files uploaded. 

### 3. Make Maintenance Easy

1. Update and Show document status

<p align="center">
  <img width="822" height="139" alt="Git Hook" src="https://github.com/user-attachments/assets/ea46a4b4-3194-40f7-ace9-378c0a250ad9" />
</p>

> While enabling user to track documentation status through file changes after saved, we also track the file status with git. With Git Hook, after commit, doch CLI will be called to update document status.

<p align="center">
  <img width="855" height="147" alt="doch CLI" src="https://github.com/user-attachments/assets/2617cd30-81f5-4880-98b6-7e1ad200ba3f" />
</p>

> Since we have a CLI, typing ‘doch drift fileurl’ in the terminal will have the same effect. We can also type doch --help for more commands. If a non-existing command is prompted, user will be asked to use `doch --help` to check what are the existing commands.

<p align="center">
  <img width="1001" height="221" alt="Status" src="https://github.com/user-attachments/assets/45b49c2c-c16b-4d29-9f80-21daee8b9e95" />
</p>

> The document status is shown in the right bottom status bar. `Undocumented`, `Docs Uncommited` and `Uncommited Docs` is marked red, `Stale` and `No Matched Source` is marked yellow, while up to date document, `Documented` and `Sync` has no colour.

2. Detect documentation issue
- This acts like a auto suggest doc updates. (In future implementation, this will be implemented inside the doch CLI so it can work with git hook and auto suggest what to add from diffs or PR)

<p align="center">
  <img width="1916" height="1023" alt="No issues found" src="https://github.com/user-attachments/assets/ab54b7a8-547b-4557-a632-57854e10238b" />
</p>

>  Detecting a clean and inclusive doucmentation will show "No significant issues found.". Let us test what will happen after we deleted some of the descriptions for the functions and methods. 👇

<p align="center">
  <img width="1915" height="1023" alt="With issues" src="https://github.com/user-attachments/assets/b4b7a87f-778d-42c0-9090-8c8987b88cfa" />
</p>

> AI successfully detected the issues and show to the users, mentioning what are the problems and affected functions and methods.

## Requirements

Unknown for the moment.

## Known Issues

None for the moment.

> To report any issues, open command palette `[Ctrl+Shift+P]`, and type "Doc Helper: Report Issue", you will be guided to the GitHub report issue in Doc Helper repository.

## Release Notes

### 1.0.0

Initial release of Doc Helper
