import * as vscode from 'vscode';
import { Task, TaskProvider } from '../models/task';

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