import * as vscode from 'vscode';
import { TaskTreeProvider, TaskManager, SortMode } from './../providers/taskTreeProvider';

export async function addTask(context: vscode.ExtensionContext, taskManager: TaskManager, taskTreeProvider: TaskTreeProvider) {
  const title = await vscode.window.showInputBox({
      prompt: 'Enter task title',
      placeHolder: 'e.g., Document UserService class'
  });

  if (!title) {
    return;
  }

  const description = await vscode.window.showInputBox({
      prompt: 'Enter task description (optional)',
      placeHolder: 'Additional details about the task'
  });

  const priorityOptions = [
      { label: '🔴 High Priority', value: 'high' as const },
      { label: '🟡 Medium Priority', value: 'medium' as const },
      { label: '🟢 Low Priority', value: 'low' as const }
  ];

  const prioritySelection = await vscode.window.showQuickPick(priorityOptions, {
      placeHolder: 'Select priority level'
  });

  if (!prioritySelection) {
    return;
  }

  // File selection
  let fileUri: string | undefined;
  let lineNumber: number | undefined;
  
  const fileOptions: vscode.QuickPickItem[] = [
      { label: '🚫 No file association', description: 'Create task without linking to a file' }
  ];

  const editor = vscode.window.activeTextEditor;
  if (editor) {
      const currentFileName = vscode.workspace.asRelativePath(editor.document.uri);
      fileOptions.splice(1, 0, {
          label: `📝 Current file (${currentFileName})`,
          description: editor.document.uri.fsPath,
          detail: `Line ${editor.selection.active.line + 1}`
      });
  }

  // Add workspace files
  if (vscode.workspace.workspaceFolders) {
      const files = await vscode.workspace.findFiles('**/*.{ts,js,tsx,jsx,py,java,cs,cpp,c,h,php,rb,go,rs,kt,swift,dart,vue,html,css,scss,sass,less,json,yaml,yml,xml,md}', '**/node_modules/**');
      
      files.forEach(file => {
          const relativePath = vscode.workspace.asRelativePath(file);
          // Avoid duplicating current file
          if (editor && file.fsPath !== editor.document.uri.fsPath) {
              fileOptions.push({
                  label: `📄 ${relativePath}`,
                  description: file.fsPath
              });
          } else if (!editor) {
              fileOptions.push({
                  label: `📄 ${relativePath}`,
                  description: file.fsPath
              });
          }
      });
  }

  const selectedFile = await vscode.window.showQuickPick(fileOptions, {
      placeHolder: 'Select a file to associate with this task (optional)',
      canPickMany: false
  });

  if (selectedFile === undefined) {
    return;
  } // User cancelled

  if (selectedFile.label.startsWith('📝 Current file')) {
      fileUri = editor!.document.uri.fsPath;
      lineNumber = editor!.selection.active.line + 1;
  } else if (selectedFile.label !== '📄 No file association') {
      fileUri = selectedFile.description;
  }

  // Deadline selection
  let deadline: Date | undefined;
  const deadlineOptions = [
      { label: '⏰ No deadline', description: 'Task has no specific due date' },
      { label: '📅 Today', description: 'Due by end of today' },
      { label: '📅 Tomorrow', description: 'Due by end of tomorrow' },
      { label: '📅 This week', description: 'Due by end of this week' },
      { label: '📅 Next week', description: 'Due by end of next week' },
      { label: '📅 Custom date', description: 'Enter a specific deadline date' }
  ];

  const selectedDeadline = await vscode.window.showQuickPick(deadlineOptions, {
      placeHolder: 'Set a deadline for this task (optional)',
      canPickMany: false
  });

  if (selectedDeadline === undefined) {
    return;
  } // User cancelled

  if (selectedDeadline.label !== '⏰ No deadline') {
      const now = new Date();
      
      switch (selectedDeadline.label) {
          case '📅 Today':
              deadline = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
              break;
          case '📅 Tomorrow':
              deadline = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 23, 59, 59);
              break;
          case '📅 This week':
              const daysUntilSunday = 7 - now.getDay();
              deadline = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysUntilSunday, 23, 59, 59);
              break;
          case '📅 Next week':
              const daysUntilNextSunday = 7 - now.getDay() + 7;
              deadline = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysUntilNextSunday, 23, 59, 59);
              break;
          case '📅 Custom date':
              const dateInput = await vscode.window.showInputBox({
                  prompt: 'Enter deadline date (YYYY-MM-DD or MM/DD/YYYY)',
                  placeHolder: 'e.g., 2025-12-31 or 12/31/2025',
                  validateInput: (value: string) => {
                      if (!value) {
                        return 'Please enter a date';
                      }
                      const date = new Date(value);
                      if (isNaN(date.getTime())) {
                          return 'Invalid date format. Use YYYY-MM-DD or MM/DD/YYYY';
                      }
                      if (date < new Date()) {
                          return 'Deadline cannot be in the past';
                      }
                      return null;
                  }
              });
              
              if (dateInput) {
                  deadline = new Date(dateInput);
                  // Set to end of day
                  deadline.setHours(23, 59, 59, 999);
              }
              break;
      }
  }

  taskManager.addTask({
      title,
      description: description || '',
      completed: false,
      priority: prioritySelection.value as 'high' | 'medium' | 'low',
      fileUri,
      lineNumber,
      deadline
  });

  taskTreeProvider.refresh();
  vscode.window.showInformationMessage(`Task "${title}" created successfully!`);
}

export async function editTask(context: vscode.ExtensionContext, taskManager: TaskManager, taskTreeProvider: TaskTreeProvider, taskTreeItem: any) {
  const taskId = taskTreeItem.task.id;
  const currentTask = taskManager.getTasks().find(t => t.id === taskId);
  
  if (!currentTask) {
    return;
  }

  const newTitle = await vscode.window.showInputBox({
      prompt: 'Edit task title',
      value: currentTask.title
  });

  if (newTitle === undefined) {
    return; // User cancelled
  }

  const newDescription = await vscode.window.showInputBox({
      prompt: 'Edit task description',
      value: currentTask.description
  });

  if (newDescription === undefined) {
    return; // User cancelled
  }

  // Priority selection
  const priorityOptions = [
      { label: '🔴 High Priority', value: 'high', picked: currentTask.priority === 'high' },
      { label: '🟡 Medium Priority', value: 'medium', picked: currentTask.priority === 'medium' },
      { label: '🟢 Low Priority', value: 'low', picked: currentTask.priority === 'low' }
  ];

  const selectedPriority = await vscode.window.showQuickPick(priorityOptions, {
      placeHolder: 'Select task priority',
      canPickMany: false
  });

  if (!selectedPriority) {
    return; // User cancelled
  }

  // File selection
  const fileOptions: vscode.QuickPickItem[] = [
      { label: '📄 No file association', description: 'Remove file link from this task' }
  ];

  // Add workspace files
  if (vscode.workspace.workspaceFolders) {
      const files = await vscode.workspace.findFiles('**/*.{ts,js,tsx,jsx,py,java,cs,cpp,c,h,php,rb,go,rs,kt,swift,dart,vue,html,css,scss,sass,less,json,yaml,yml,xml,md}', '**/node_modules/**');
      
      files.forEach(file => {
          const relativePath = vscode.workspace.asRelativePath(file);
          fileOptions.push({
              label: `📁 ${relativePath}`,
              description: file.fsPath,
              detail: currentTask.fileUri === file.fsPath ? 'Currently selected' : undefined
          });
      });
  }

  const selectedFile = await vscode.window.showQuickPick(fileOptions, {
      placeHolder: 'Select a file to associate with this task (optional)',
      canPickMany: false
  });

  if (selectedFile === undefined) {
    return; // User cancelled
  }

  const newFilePath = selectedFile.label === '📄 No file association' ? undefined : selectedFile.description;

  // Deadline editing
  const currentDeadlineText = currentTask.deadline 
      ? `Current: ${currentTask.deadline.toLocaleDateString()}`
      : 'No deadline set';
  
  const deadlineOptions = [
      { label: '⏰ No deadline', description: 'Remove any deadline from this task', picked: !currentTask.deadline },
      { label: '📅 Today', description: 'Due by end of today' },
      { label: '📅 Tomorrow', description: 'Due by end of tomorrow' },
      { label: '📅 This week', description: 'Due by end of this week' },
      { label: '📅 Next week', description: 'Due by end of next week' },
      { label: '📅 Custom date', description: 'Enter a specific deadline date' },
      { label: '📅 Keep current', description: currentDeadlineText, picked: !!currentTask.deadline }
  ];

  const selectedDeadline = await vscode.window.showQuickPick(deadlineOptions, {
      placeHolder: `Edit deadline for this task (${currentDeadlineText})`,
      canPickMany: false
  });

  if (selectedDeadline === undefined) {
    return; // User cancelled
  }

  let newDeadline: Date | undefined = currentTask.deadline;

  if (selectedDeadline.label !== '📅 Keep current') {
      if (selectedDeadline.label === '⏰ No deadline') {
          newDeadline = undefined;
      } else {
          const now = new Date();
          
          switch (selectedDeadline.label) {
              case '📅 Today':
                  newDeadline = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
                  break;
              case '📅 Tomorrow':
                  newDeadline = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 23, 59, 59);
                  break;
              case '📅 This week':
                  const daysUntilSunday = 7 - now.getDay();
                  newDeadline = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysUntilSunday, 23, 59, 59);
                  break;
              case '📅 Next week':
                  const daysUntilNextSunday = 7 - now.getDay() + 7;
                  newDeadline = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysUntilNextSunday, 23, 59, 59);
                  break;
              case '📅 Custom date':
                  const dateInput = await vscode.window.showInputBox({
                      prompt: 'Enter deadline date (YYYY-MM-DD or MM/DD/YYYY)',
                      placeHolder: 'e.g., 2025-12-31 or 12/31/2025',
                      value: currentTask.deadline ? currentTask.deadline.toISOString().split('T')[0] : '',
                      validateInput: (value: string) => {
                          if (!value) {
                            return 'Please enter a date';
                          }
                          const date = new Date(value);
                          if (isNaN(date.getTime())) {
                              return 'Invalid date format. Use YYYY-MM-DD or MM/DD/YYYY';
                          }
                          return null;
                      }
                  });
                  
                  if (dateInput) {
                      newDeadline = new Date(dateInput);
                      // Set to end of day
                      newDeadline.setHours(23, 59, 59, 999);
                  } else {
                      return; // User cancelled date input
                  }
                  break;
          }
      }
  }

  taskManager.updateTask(taskId, {
      title: newTitle,
      description: newDescription,
      priority: selectedPriority.value as 'high' | 'medium' | 'low',
      fileUri: newFilePath,
      deadline: newDeadline
  });

  taskTreeProvider.refresh();
  vscode.window.showInformationMessage('Task updated successfully!');
}

export async function toggleSort(taskTreeProvider: TaskTreeProvider) {
  const currentSort = taskTreeProvider.getSortMode();
  const sortOptions = [
      { 
          label: '📅 Date of Creation', 
          value: SortMode.CreationOrder,
          description: 'Sort by when tasks were created (newest first)',
          picked: currentSort === SortMode.CreationOrder
      },
      { 
          label: '🎯 Priority', 
          value: SortMode.Priority,
          description: 'Sort by priority level (high → medium → low)',
          picked: currentSort === SortMode.Priority
      },
      { 
          label: '🔤 Name', 
          value: SortMode.Alphabetical,
          description: 'Sort by task title (A → Z)',
          picked: currentSort === SortMode.Alphabetical
      },
      { 
          label: '✅ Status', 
          value: SortMode.Status,
          description: 'Sort by completion status (pending first)',
          picked: currentSort === SortMode.Status
      },
      { 
          label: '⏰ Deadline', 
          value: SortMode.Deadline,
          description: 'Sort by deadline (overdue and urgent first)',
          picked: currentSort === SortMode.Deadline
      }
  ];

  const selectedSort = await vscode.window.showQuickPick(sortOptions, {
      placeHolder: 'Choose how to sort tasks',
      canPickMany: false
  });

  if (selectedSort) {
      taskTreeProvider.setSortMode(selectedSort.value);
      vscode.window.showInformationMessage(`Tasks sorted by ${selectedSort.label.replace(/^\S+\s/, '')}`);
  }
}