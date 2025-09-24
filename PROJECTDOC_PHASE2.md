# Doc Helper (Track 3, Problem Statement 1)

This is a Visual Studio Code extension prototype to solve the CodeNection Hackathon's track 3 and problem statement 1, **"Fix the Docs: Smarter, Faster, Maintainable Documentation for the Real World by iFAST"**. It is a smart documentation assistant/tool that improves how technical documentation is created, consumed, and maintained in evolving software environments.

## Enhanced Implementation

You may refer to our Phase 1 implementation [here](PROJECTDOC_PHASE1.md). Having the opportunity to advance into Phase 2, we have made numerous enhancements, from minor refinements to major additions, to make our extension better.

### **Major Additions**

#### 1. Inline Ghost Suggestion
Our inline ghost suggestion works just like GitHub Copilot, but works on markdown documentation file instead.

<p align="center">
<img width="1489" height="532" alt="Image" src="https://github.com/user-attachments/assets/ddf882e1-47d2-4d97-8d0f-acae92a8a9dd" />
</p>

#### 2. Source/Document Linking

1. Imagine having so many files that you can hardly find your respective documentation for the source code. Now with this "Open Respective Code/Docs", users can click and show the documentation for the code and vice versa.

<p align="center">
<img width="1919" height="818" alt="Image" src="https://github.com/user-attachments/assets/8616e650-1682-49e3-a5ab-c8672a288e27" />
</p>

> Pressing "Open Respective Code/Docs" in source code file `test.js` shows `test.md`.

2. <p id="linkfunction">Finding the documented function in source code file is now easier also.</p>

<p align="center">
<img width="1799" height="601" alt="Image" src="https://github.com/user-attachments/assets/03c7b553-4959-4be4-8e02-b81516d65c7f" />
</p>

> Press `Ctrl` and left click on the function documented on markdown file, you will then be redirected to the line at source code where the function is defined.

#### 3. Offline Documentation Error Detection

Detect documentation issues need network access to call AI model. Currently, we have added 2 significant error detection that works offline as well.

1. Detect Numbering Issues

<p align="center">
<img width="1258" height="850" alt="Image" src="https://github.com/user-attachments/assets/47a5b858-915d-4c97-95cd-e633ac39e657" />
</p>

> When 1 is deleted from the first function 'restoreState', diagnosed problem is underline with yellow curly warning line. 

2. Detect Missing Functions

<p align="center">
<img width="1292" height="881" alt="Image" src="https://github.com/user-attachments/assets/8b1920d6-269e-4c82-9d9a-f6589f3c563f" />
</p>

> When the whole function 'restoreState' is deleted, diagnosed problems are now 2 including the numbering problem.

3. Fix The Issues

<p align="center">
<img width="904" height="305" alt="Image" src="https://github.com/user-attachments/assets/e21a0798-00d8-44da-ba59-450eebcafc99" />
</p>

> We provide quick fixes to the users. This includes adding documentation template for only one or ALL missing functions, add new numbered heading, renumber the headings, or to just ignore the problem if it was intended.

#### 4. Documentation Snippets/Templates

<p align="center">
<img width="1353" height="1020" alt="Image" src="https://github.com/user-attachments/assets/8090fd08-7665-47cf-8f49-944cda7619a8" />
</p>

> Snippet or template is provided for faster writing. We currently have userdoc, techdoc and function as template for user documentation, technical documentation, and function template respectively. More could be added in the future by just easily editing the snippets.json.

#### 5. Generate General Documentations

We also added generate general documentations such as README.md, ARCHITECTURE.md, ROADMAP.md, CONFIGURATION.md and API.md.

<p align="center">
<img width="1919" height="766" alt="Image" src="https://github.com/user-attachments/assets/4fc8e307-8b8e-426a-8eb8-0502cb38502b" />
</p>

> Pressing onto the documentation button beside the search icon, users can select what documentation type to generate. <br><br>**Note:** Since we are only using free models and there are limited token, the result might be inaccurate. The result will also be slow due to the free server deployment using Render.

#### 6. Increases Flexibility with `config.yml` file

<p align="center">
<img width="1045" height="493" alt="Image" src="https://github.com/user-attachments/assets/0d49e7e2-49f8-4c89-b458-65387896aeb6" />
</p>

> Config file now can identify which source code directories and language to track. Users can edit based on the project language that they are working with.

#### 7. Detect Documentation Issues With Suggested Fixes/Regenerate Docs

<p align="center">
<img width="826" height="1019" alt="Image" src="https://github.com/user-attachments/assets/6a73a083-125c-4db9-930b-4cfe104e677c" />
</p>

> After we detected documentation issues with AI, we can choose to regenerate the documentation or just ignore it and adjust ourselves.

If we choose to regenerate the documentation, latest AI generated documentation will appears at the right with diff view. Users can still edit on the left while watching the changes and compare with AI content.

<p align="center">
<img width="1919" height="1021" alt="Image" src="https://github.com/user-attachments/assets/001d4701-e069-42fe-b1a8-340d5c17ce57" />
</p>

#### 8. To-do List Tracker

Who knows sometimes tasks are just too many that we tends to forget about what should we do next. This is exactly how we miss out our stale documentation. By using a to-do list tracker, we can track which documentation we should do, adding new task with a title, description(optional), priority, associated file(optional), and deadline(optional).

<p align="center">
<img width="1919" height="1024" alt="Image" src="https://github.com/user-attachments/assets/217331db-903d-492a-85b0-e75920d40ad8" />
</p>

> The tasks will then show above the chatbot panel. Once completed, click on the task and it will become completed with a tick icon. Users can also edit tasks, sort tasks and delete task if the task record is completed and not needed anymore.

### **Minor Refinements**

#### 1. Git Hook Configuration

Now users can have the Git Hooks are configured automatically when they initialized `.doch` directory in their workspace. We also updated the git hook logic so this will track documentation status and make sure that `main` branch documentation status is always up-to-date when users push their files to remote repository.

- Source file commit time > Documentation commit time = Stale
- Documentation commit time >= Source file commit time = Up to date
- Push stale documentation to other branches = Warning
- Push stale documentation to main = Block
- After merge, git hook updates documentation status using same logic as post-commit

#### 2. User Friendly Chatbot

Chatbot can now track the current active editor and feed the file automatically to the AI. Users do not need to upload files manually unless they want to feed more than one file at a time.

#### 3. Generate and Detect Multiple Files

Source code file in a real project will be a lot, generating documentation by finding file and pressing the documentation button is time-consuming and not user friendly. Now we have added an option to generate or detect from selected files.

<p align="center">
<img width="1366" height="866" alt="Image" src="https://github.com/user-attachments/assets/d8fefe83-20fe-4b5d-a25b-d11bbf18658b" />
</p>

> Click on the icon at the category instead of specific file. A prompt will pop out and select the files you want to generate documentation with. The files are sort alphabetically from A-Z as well so it is more organized.

#### 4. Settings

<p align="center">
<img width="1461" height="722" alt="Image" src="https://github.com/user-attachments/assets/7b9d6344-7438-43ff-b2e4-d0cc6e3cd0c6" />
</p>

> Users have more flexibility to choose different settings, for example different docs directory, toggling inline suggestion and toggle show underline on [linking function](#linkfunction).

#### 5. Keyboard Shortcuts

There are multiple ways user can change the toggle settings for text suggestion and hyperlink underline.

<p align="center">
<img width="417" height="88" alt="Image" src="https://github.com/user-attachments/assets/0f13742e-a271-4d9a-88ee-344474b4d2d5" />
</p>

> Right click on the markdown editor will also show toggle with keyboard shortcuts as well.

#### 6. Status Bar Upgrade

By upgrading our status bar, we eliminated the need to go to the VS Code Settings to configure our extension settings

<p align="center">
<img width="1502" height="1020" alt="Image" src="https://github.com/user-attachments/assets/1b69ca46-7df9-4e1c-855d-2af8edc40910" />
</p>

> Now, users can hover onto the status bar to refresh, snooze inline ghost suggestion for 5 minutes, or redirect to the VS Code settings of our Doc Helper extension. Clicking on our status bar item will also show the two toggle settings above.