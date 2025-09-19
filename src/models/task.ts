export interface Task {
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

export interface TaskProvider {
    getTasks(): Task[];
    addTask(task: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>): Task;
    updateTask(id: string, updates: Partial<Task>): Task | undefined;
    deleteTask(id: string): boolean;
    toggleTask(id: string): Task | undefined;
}