// import type { ChatAgentTask } from './chats.js';

// export type ChatAgentTask = {
//   agentId: ObjectId;
//   chatId: ObjectId;
//   messageId: UUID;
//   responseId: UUID;
//   text: string;
// };

// type TaskProperties = {
//   properties: ChatAgentTask;
//   taskName: 'chatAgent';
// };

// interface Task {
//   queueId: string;
//   taskId: string;
//   taskName: string;
//   taskProperties: TaskProperties;
// }

// type TaskHandler<T extends TaskProperties> = (
//   task: { taskProperties: T } & Task
// ) => Promise<void>;

// export class TaskQueue {
//   private queues: { [queueId: string]: Task[] } = {};
//   private runningTasks: { [queueId: string]: boolean } = {};
//   private taskHandlers: { [taskName: string]: TaskHandler<any> } = {};

//   private async processQueue(queueId: string): Promise<void> {
//     if (this.runningTasks[queueId]) {
//       return; // Queue is already being processed
//     }
//     this.runningTasks[queueId] = true;

//     while (this.queues[queueId] && this.queues[queueId].length > 0) {
//       const task = this.queues[queueId].shift();
//       if (task) {
//         const handler = this.taskHandlers[task.taskName];
//         if (handler) {
//           try {
//             await handler(task);
//           } catch (error) {
//             console.error(`Error processing task ${task.taskId}:`, error);
//           }
//         } else {
//           console.warn(`No handler registered for task name: ${task.taskName}`);
//         }
//       }
//     }

//     this.runningTasks[queueId] = false;
//   }

//   addTask(task: Task): void {
//     if (!this.queues[task.queueId]) {
//       this.queues[task.queueId] = [];
//     }
//     this.queues[task.queueId].push(task);
//     this.processQueue(task.queueId);
//   }

//   registerTaskHandler<T extends TaskProperties>(
//     taskName: T['taskName'],
//     handler: TaskHandler<T>
//   ): void {
//     this.taskHandlers[taskName] = handler;
//   }

//   removeTask(queueId: string, taskId: string): void {
//     if (this.queues[queueId]) {
//       this.queues[queueId] = this.queues[queueId].filter(
//         (task) => task.taskId !== taskId
//       );
//     }
//   }
// }

// // import TaskQueue from './task-queue'; // Assuming the class is in 'task-queue.ts'

// // const queue = new TaskQueue();

// // // Register task handlers
// // queue.registerTaskHandler('email', async (task) => {
// //   console.log('Sending email:', task.taskProperties);
// //   // ... logic to send email
// // });

// // queue.registerTaskHandler('notification', async (task) => {
// //   console.log('Sending notification:', task.taskProperties);
// //   // ... logic to send notification
// // });

// // // Add tasks
// // queue.addTask({
// //   queueId: 'queue1',
// //   taskId: 'task1',
// //   taskName: 'email',
// //   taskProperties: { to: 'user@example.com', subject: 'Welcome' },
// // });

// // queue.addTask({
// //   queueId: 'queue1',
// //   taskId: 'task2',
// //   taskName: 'notification',
// //   taskProperties: { message: 'New task added' },
// // });

// // queue.addTask({
// //   queueId: 'queue2',
// //   taskId: 'task3',
// //   taskName: 'email',
// //   taskProperties: { to: 'admin@example.com', subject: 'Report' },
// // });
