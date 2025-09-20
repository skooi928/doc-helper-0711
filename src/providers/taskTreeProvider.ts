import * as vscode from 'vscode';

interface Task {
    id: string;
    title: string;
    description: string;
    completed: boolean;
    priority: 'low' | 'medium' | 'high';
    createdAt: Date;
    updatedAt: Date;
    deadline?: Date; 
    fileUri?: string; 
    lineNumber?: number; 
}

interface TaskProvider {
    getTasks(): Task[];
    addTask(task: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>): Task;
    updateTask(id: string, updates: Partial<Task>): Task | undefined;
    deleteTask(id: string): boolean;
    toggleTask(id: string): Task | undefined;
}

export enum SortMode {
    CreationOrder = 'creation',
    Priority = 'priority',
    Alphabetical = 'alphabetical',
    Status = 'status',
    Deadline = 'deadline'
}

export class TaskManager implements TaskProvider {
    private tasks: Task[] = [];
    private context: vscode.ExtensionContext;
    private readonly STORAGE_KEY = 'docHelper.tasks';

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.loadTasks();
    }

    getTasks(): Task[] {
        return [...this.tasks];
    }

    addTask(taskData: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>): Task {
        const task: Task = {
            ...taskData,
            id: this.generateId(),
            createdAt: new Date(),
            updatedAt: new Date()
        };
        
        this.tasks.push(task);
        this.saveTasks();
        return task;
    }

    updateTask(id: string, updates: Partial<Task>): Task | undefined {
        const taskIndex = this.tasks.findIndex(task => task.id === id);
        if (taskIndex === -1) {
            return undefined;
        }

        this.tasks[taskIndex] = {
            ...this.tasks[taskIndex],
            ...updates,
            updatedAt: new Date()
        };

        this.saveTasks();
        return this.tasks[taskIndex];
    }

    deleteTask(id: string): boolean {
        const initialLength = this.tasks.length;
        this.tasks = this.tasks.filter(task => task.id !== id);
        
        if (this.tasks.length !== initialLength) {
            this.saveTasks();
            return true;
        }
        return false;
    }

    toggleTask(id: string): Task | undefined {
        const task = this.tasks.find(task => task.id === id);
        if (task) {
            task.completed = !task.completed;
            task.updatedAt = new Date();
            this.saveTasks();
            return task;
        }
        return undefined;
    }

    private generateId(): string {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    }

    private saveTasks(): void {
        this.context.globalState.update(this.STORAGE_KEY, this.tasks);
    }

    private loadTasks(): void {
        const stored = this.context.globalState.get<Task[]>(this.STORAGE_KEY);
        if (stored) {
            // Convert date strings back to Date objects
            this.tasks = stored.map(task => ({
                ...task,
                createdAt: new Date(task.createdAt),
                updatedAt: new Date(task.updatedAt),
                deadline: task.deadline ? new Date(task.deadline) : undefined
            }));
        }
    }
}

export class TaskTreeItem extends vscode.TreeItem {
    constructor(
        public readonly task: Task,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(task.title, collapsibleState);
        
        // Build tooltip with file and deadline information
        let tooltip = `${task.title}\n${task.description}`;
        if (task.deadline) {
            const deadlineText = this.getDeadlineText(task.deadline);
            tooltip += `\n⏰ Deadline: ${deadlineText}`;
        }
        if (task.fileUri) {
            const fileName = task.fileUri.split(/[\\\/]/).pop() || 'Unknown file';
            tooltip += `\n📁 File: ${fileName}`;
            if (task.lineNumber) {
                tooltip += ` (Line ${task.lineNumber})`;
            }
        }
        this.tooltip = tooltip;
        
        // Build description with deadline and file info
        let description = task.description.length > 50 
            ? task.description.substring(0, 47) + '...' 
            : task.description;
        
        // Add deadline info
        if (task.deadline) {
            const deadlineInfo = this.getShortDeadlineText(task.deadline);
            description = description ? `${description} ${deadlineInfo}` : deadlineInfo;
        }
        
        // Add file info
        if (task.fileUri) {
            const fileName = task.fileUri.split(/[\\\/]/).pop() || 'Unknown';
            const fileInfo = task.lineNumber ? ` 📁${fileName}:${task.lineNumber}` : ` 📁${fileName}`;
            description = description ? `${description} ${fileInfo}` : fileInfo;
        }
        
        this.description = description;
            
        // Set icon based on completion status and priority
        this.iconPath = this.getIcon(task);
        
        // Set context value for menu commands
        this.contextValue = task.completed ? 'completedTask' : 'pendingTask';
        
        // Command to toggle completion when clicked
        this.command = {
            command: 'doc-helper-0711.toggleTask',
            title: 'Toggle Task',
            arguments: [task.id]
        };
    }

    private getDeadlineText(deadline: Date): string {
        const now = new Date();
        const diffTime = deadline.getTime() - now.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        if (diffDays < 0) {
            return `${deadline.toLocaleDateString()} (${Math.abs(diffDays)} days overdue)`;
        } else if (diffDays === 0) {
            return `${deadline.toLocaleDateString()} (due today)`;
        } else if (diffDays === 1) {
            return `${deadline.toLocaleDateString()} (due tomorrow)`;
        } else if (diffDays <= 7) {
            return `${deadline.toLocaleDateString()} (${diffDays} days)`;
        } else {
            return deadline.toLocaleDateString();
        }
    }

    private getShortDeadlineText(deadline: Date): string {
        const now = new Date();
        const diffTime = deadline.getTime() - now.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        if (diffDays < 0) {
            return `⚠️ ${Math.abs(diffDays)}d overdue`;
        } else if (diffDays === 0) {
            return `⏰ Due today`;
        } else if (diffDays === 1) {
            return `⏰ Due tomorrow`;
        } else if (diffDays <= 7) {
            return `⏰ ${diffDays}d left`;
        } else {
            return `⏰ ${deadline.toLocaleDateString()}`;
        }
    }

    private getIcon(task: Task): vscode.ThemeIcon {
        if (task.completed) {
            return new vscode.ThemeIcon('check', new vscode.ThemeColor('charts.green'));
        }
        
        // Check deadline urgency first
        if (task.deadline) {
            const now = new Date();
            const diffTime = task.deadline.getTime() - now.getTime();
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            
            if (diffDays < 0) {
                // Overdue - red warning
                return new vscode.ThemeIcon('warning', new vscode.ThemeColor('errorForeground'));
            } else if (diffDays === 0) {
                // Due today - urgent
                return new vscode.ThemeIcon('watch', new vscode.ThemeColor('errorForeground'));
            } else if (diffDays === 1) {
                // Due tomorrow - warning
                return new vscode.ThemeIcon('watch', new vscode.ThemeColor('notificationsWarningIcon.foreground'));
            } else if (diffDays <= 3) {
                // Due soon - caution
                return new vscode.ThemeIcon('watch', new vscode.ThemeColor('foreground'));
            }
        }
        
        // Fall back to priority-based icons
        switch (task.priority) {
            case 'high':
                return new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('errorForeground'));
            case 'medium':
                return new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('notificationsWarningIcon.foreground'));
            case 'low':
                return new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('charts.green'));
            default:
                return new vscode.ThemeIcon('circle-outline');
        }
    }
}

export class TaskTreeProvider implements vscode.TreeDataProvider<TaskTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<TaskTreeItem | undefined | null | void> = new vscode.EventEmitter<TaskTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<TaskTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;
    
    private currentSortMode: SortMode = SortMode.CreationOrder;

    constructor(private taskManager: TaskManager) {
        // Load saved sort preference
        const savedSort = vscode.workspace.getConfiguration('taskTracker').get<string>('sortMode');
        if (savedSort && Object.values(SortMode).includes(savedSort as SortMode)) {
            this.currentSortMode = savedSort as SortMode;
        }
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getSortMode(): SortMode {
        return this.currentSortMode;
    }

    setSortMode(mode: SortMode): void {
        this.currentSortMode = mode;
        // Save sort preference
        vscode.workspace.getConfiguration('taskTracker').update('sortMode', mode, vscode.ConfigurationTarget.Global);
        this.refresh();
    }

    getSortModeDescription(): string {
        switch (this.currentSortMode) {
            case SortMode.Priority:
                return '🎯 Sorted by Priority';
            case SortMode.Alphabetical:
                return '🔤 Sorted Alphabetically';
            case SortMode.Status:
                return '✅ Sorted by Status';
            case SortMode.Deadline:
                return '⏰ Sorted by Deadline';
            case SortMode.CreationOrder:
            default:
                return '📅 Sorted by Creation';
        }
    }

    getTreeItem(element: TaskTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: TaskTreeItem): Thenable<TaskTreeItem[]> {
        if (!element) {
            // Root level - return all tasks sorted by current mode
            const tasks = this.taskManager.getTasks();
            const sortedTasks = this.sortTasks(tasks);
            return Promise.resolve(sortedTasks.map(task => 
                new TaskTreeItem(task, vscode.TreeItemCollapsibleState.None)
            ));
        }
        return Promise.resolve([]);
    }

    private sortTasks(tasks: Task[]): Task[] {
        const tasksCopy = [...tasks];
        
        switch (this.currentSortMode) {
            case SortMode.Priority:
                return tasksCopy.sort((a, b) => {
                    // First sort by completion status (pending tasks first)
                    if (a.completed !== b.completed) {
                        return a.completed ? 1 : -1;
                    }
                    // Then sort by priority (high > medium > low)
                    const priorityOrder = { high: 0, medium: 1, low: 2 };
                    return priorityOrder[a.priority] - priorityOrder[b.priority];
                });

            case SortMode.Alphabetical:
                return tasksCopy.sort((a, b) => {
                    // First sort by completion status (pending tasks first)
                    if (a.completed !== b.completed) {
                        return a.completed ? 1 : -1;
                    }
                    // Then sort alphabetically by title
                    return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
                });

            case SortMode.Status:
                return tasksCopy.sort((a, b) => {
                    // First sort by completion status (pending tasks first)
                    if (a.completed !== b.completed) {
                        return a.completed ? 1 : -1;
                    }
                    // Then sort by creation date for same status
                    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
                });

            case SortMode.Deadline:
                return tasksCopy.sort((a, b) => {
                    // First sort by completion status (pending tasks first)
                    if (a.completed !== b.completed) {
                        return a.completed ? 1 : -1;
                    }
                    
                    // Handle tasks without deadlines (put them last)
                    if (!a.deadline && !b.deadline) {
                        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
                    }
                    if (!a.deadline) {
                        return 1;
                    }
                    if (!b.deadline) {
                        return -1;
                    }
                    
                    // Sort by deadline (earliest first)
                    const deadlineCompare = a.deadline.getTime() - b.deadline.getTime();
                    if (deadlineCompare !== 0) {
                        return deadlineCompare;
                    }
                    
                    // If same deadline, sort by priority
                    const priorityOrder = { high: 0, medium: 1, low: 2 };
                    return priorityOrder[a.priority] - priorityOrder[b.priority];
                });

            case SortMode.CreationOrder:
            default:
                return tasksCopy.sort((a, b) => {
                    // Sort by creation date (newest first)
                    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
                });
        }
    }
}