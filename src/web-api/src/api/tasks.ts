interface Task {
  handler: () => Promise<void>;
}

export class TaskRunner {
  private isProcessing: boolean = false;
  private runningTasks: Set<string> = new Set();
  private taskQueue: Map<string, Task[][]> = new Map();

  private async executeTask(chatId: string, task: Task): Promise<void> {
    try {
      await task.handler();
    } catch (error) {
      console.error(`Error executing task for chat ${chatId}:`, error);
    }
  }

  private hasAvailableTasks(): boolean {
    return Array.from(this.taskQueue.values()).some(
      (groups) => groups.length > 0
    );
  }

  private async processNextTask() {
    this.isProcessing = true;

    while (this.hasAvailableTasks()) {
      const availableChatIds = Array.from(this.taskQueue.keys()).filter(
        (chatId) => !this.runningTasks.has(chatId)
      );

      if (availableChatIds.length === 0) {
        // If no tasks can be run right now, break the loop and reschedule
        break;
      }

      for (const chatId of availableChatIds) {
        const taskGroups = this.taskQueue.get(chatId)!;
        if (taskGroups.length > 0) {
          const currentGroup = taskGroups.shift()!;
          this.runningTasks.add(chatId);

          Promise.all(
            currentGroup.map((task) => this.executeTask(chatId, task))
          )
            .then(() => {
              this.runningTasks.delete(chatId);
              this.scheduleProcessing();
            })
            .catch(console.error);

          if (taskGroups.length === 0) {
            this.taskQueue.delete(chatId);
          }
        }
      }
    }

    this.isProcessing = false;
  }

  private scheduleProcessing() {
    if (!this.isProcessing) {
      setImmediate(() => this.processNextTask());
    }
  }

  addTask(chatId: string, handler: () => Promise<void>) {
    if (!this.taskQueue.has(chatId)) {
      this.taskQueue.set(chatId, []);
    }
    this.taskQueue.get(chatId)!.push([{ handler }]);
    this.scheduleProcessing();
  }

  addTasks(chatId: string, handlers: (() => Promise<void>)[]) {
    if (!this.taskQueue.has(chatId)) {
      this.taskQueue.set(chatId, []);
    }
    this.taskQueue.get(chatId)!.push(handlers.map((handler) => ({ handler })));
    this.scheduleProcessing();
  }
}
