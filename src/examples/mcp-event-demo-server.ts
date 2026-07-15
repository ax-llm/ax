import { randomUUID } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { fileURLToPath } from 'node:url';

type JsonRpcRequest = {
  jsonrpc: '2.0';
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
};

type DemoTask = {
  taskId: string;
  status: 'working' | 'input_required' | 'completed' | 'failed' | 'cancelled';
  statusMessage?: string;
  createdAt: string;
  lastUpdatedAt: string;
  ttl: null;
  pollInterval: number;
};

type DemoResource = {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
};

export class AxMCPEventDemoServer {
  private readonly server = createServer((request, response) => {
    void this.handle(request, response);
  });
  private readonly listeners = new Set<ServerResponse>();
  private readonly history: Array<{ id: number; message: unknown }> = [];
  private readonly tasks = new Map<string, DemoTask>();
  private readonly resources = new Map<string, DemoResource>([
    [
      'demo://inventory',
      {
        uri: 'demo://inventory',
        name: 'Inventory snapshot',
        description: 'Current warehouse inventory',
        mimeType: 'application/json',
      },
    ],
    [
      'demo://orders',
      {
        uri: 'demo://orders',
        name: 'Open orders',
        description: 'Orders waiting for fulfillment',
        mimeType: 'application/json',
      },
    ],
  ]);
  private readonly subscriptions = new Set<string>();
  private readonly subscriptionCounts = new Map<string, number>();
  private readonly subscriptionWaiters = new Map<string, Set<() => void>>();
  private readonly taskWaiters = new Set<(taskId: string) => void>();
  private readonly listenerWaiters = new Set<() => void>();
  private sequence = 0;
  private sessionId = randomUUID();
  private endpoint?: string;

  async start(port = 0): Promise<string> {
    if (this.endpoint) return this.endpoint;
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(port, '127.0.0.1', () => {
        this.server.off('error', reject);
        resolve();
      });
    });
    const address = this.server.address();
    if (!address || typeof address === 'string') {
      throw new Error('MCP demo server did not bind a TCP port');
    }
    this.endpoint = `http://127.0.0.1:${address.port}/mcp`;
    return this.endpoint;
  }

  updateResource(uri = 'demo://inventory'): void {
    if (!this.subscriptions.has(uri)) return;
    this.notify('notifications/resources/updated', { uri });
  }

  addResource(
    resource: DemoResource = {
      uri: 'demo://alerts',
      name: 'Inventory alerts',
      description: 'Low-stock and fulfillment alerts',
      mimeType: 'application/json',
    }
  ): void {
    this.resources.set(resource.uri, { ...resource });
    this.notify('notifications/resources/list_changed');
  }

  removeResource(uri: string): void {
    if (!this.resources.delete(uri)) return;
    this.notify('notifications/resources/list_changed');
  }

  async waitForSubscription(
    uri = 'demo://inventory',
    timeoutMs = 15_000
  ): Promise<void> {
    if (this.subscriptions.has(uri)) return;
    let resolveSignal!: () => void;
    const signal = new Promise<void>((resolve) => {
      resolveSignal = resolve;
      const waiters = this.subscriptionWaiters.get(uri) ?? new Set();
      waiters.add(resolve);
      this.subscriptionWaiters.set(uri, waiters);
    });
    try {
      await waitForDemoSignal(signal, `subscription ${uri}`, timeoutMs);
    } finally {
      this.subscriptionWaiters.get(uri)?.delete(resolveSignal);
    }
  }

  isSubscribed(uri = 'demo://inventory'): boolean {
    return this.subscriptions.has(uri);
  }

  getSubscriptionCount(uri = 'demo://inventory'): number {
    return this.subscriptionCounts.get(uri) ?? 0;
  }

  async waitForSubscriptionCount(
    count: number,
    uri = 'demo://inventory',
    timeoutMs = 15_000
  ): Promise<void> {
    const startedAt = Date.now();
    while (this.getSubscriptionCount(uri) < count) {
      if (Date.now() - startedAt >= timeoutMs) {
        throw new Error(
          `Timed out waiting for ${count} subscriptions to ${uri}`
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  async waitForUnsubscribe(uri: string, timeoutMs = 15_000): Promise<void> {
    const startedAt = Date.now();
    while (this.subscriptions.has(uri)) {
      if (Date.now() - startedAt >= timeoutMs) {
        throw new Error(`Timed out waiting for unsubscription from ${uri}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  async waitForTask(timeoutMs = 15_000): Promise<string> {
    const existing = [...this.tasks.keys()].at(-1);
    if (existing) return existing;
    let remove!: (taskId: string) => void;
    const signal = new Promise<string>((resolve) => {
      remove = resolve;
      this.taskWaiters.add(resolve);
    });
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        signal,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error('Timed out waiting for task creation')),
            timeoutMs
          );
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
      this.taskWaiters.delete(remove);
    }
  }

  async waitForListeningConnection(timeoutMs = 15_000): Promise<void> {
    if (this.listeners.size > 0) return;
    let resolveSignal!: () => void;
    const signal = new Promise<void>((resolve) => {
      resolveSignal = resolve;
      this.listenerWaiters.add(resolve);
    });
    try {
      await waitForDemoSignal(signal, 'MCP listening connection', timeoutMs);
    } finally {
      this.listenerWaiters.delete(resolveSignal);
    }
  }

  changeCatalog(): void {
    this.notify('notifications/tools/list_changed');
  }

  requestTaskInput(taskId: string): void {
    this.updateTask(taskId, 'input_required', 'Choose a reindex strategy');
  }

  completeTask(taskId: string): void {
    this.updateTask(taskId, 'completed', 'Reindex complete');
  }

  dropListeningConnections(): void {
    for (const response of this.listeners) response.end();
    this.listeners.clear();
  }

  async close(): Promise<void> {
    this.dropListeningConnections();
    await new Promise<void>((resolve, reject) =>
      this.server.close((error) => (error ? reject(error) : resolve()))
    );
    this.endpoint = undefined;
  }

  private async handle(
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<void> {
    if (request.url?.startsWith('/control/')) {
      await this.control(request, response);
      return;
    }
    if (request.url !== '/mcp') {
      response.writeHead(404).end();
      return;
    }
    if (request.method === 'GET') {
      this.listen(request, response);
      return;
    }
    if (request.method === 'DELETE') {
      this.sessionId = randomUUID();
      this.subscriptions.clear();
      response.writeHead(204).end();
      return;
    }
    if (request.method !== 'POST') {
      response.writeHead(405).end();
      return;
    }
    try {
      const message = JSON.parse(
        await this.readBody(request)
      ) as JsonRpcRequest;
      if (message.id === undefined) {
        response.writeHead(202).end();
        return;
      }
      const result = await this.dispatch(message);
      const body = JSON.stringify({ jsonrpc: '2.0', id: message.id, result });
      response.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'MCP-Session-Id': this.sessionId,
      });
      response.end(body);
    } catch (error) {
      const body = JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32603, message: String(error) },
      });
      response.writeHead(500, { 'Content-Type': 'application/json' });
      response.end(body);
    }
  }

  private async control(
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (request.method === 'GET' && url.pathname === '/control/state') {
      this.writeJSON(response, {
        resources: [...this.resources.values()],
        subscriptions: [...this.subscriptions],
        subscriptionCounts: Object.fromEntries(this.subscriptionCounts),
        listeners: this.listeners.size,
        tasks: [...this.tasks.values()],
      });
      return;
    }
    if (request.method !== 'POST') {
      response.writeHead(405).end();
      return;
    }
    if (url.pathname === '/control/resource') {
      this.updateResource(url.searchParams.get('uri') ?? 'demo://inventory');
      response.writeHead(202).end();
      return;
    }
    if (url.pathname === '/control/catalog/add') {
      const uri = url.searchParams.get('uri') ?? 'demo://alerts';
      this.addResource({
        uri,
        name: url.searchParams.get('name') ?? 'Dynamic resource',
        mimeType: url.searchParams.get('mimeType') ?? 'application/json',
      });
      response.writeHead(202).end();
      return;
    }
    if (url.pathname === '/control/catalog/remove') {
      this.removeResource(url.searchParams.get('uri') ?? 'demo://orders');
      response.writeHead(202).end();
      return;
    }
    if (url.pathname === '/control/drop') {
      this.dropListeningConnections();
      response.writeHead(202).end();
      return;
    }
    if (url.pathname === '/control/task/complete') {
      const taskId =
        url.searchParams.get('taskId') ?? [...this.tasks.keys()].at(-1);
      if (!taskId) {
        this.writeJSON(response, { error: 'No demo task exists' }, 409);
        return;
      }
      this.completeTask(taskId);
      this.writeJSON(response, this.requireTask(taskId));
      return;
    }
    response.writeHead(404).end();
  }

  private writeJSON(
    response: ServerResponse,
    value: unknown,
    status = 200
  ): void {
    const body = JSON.stringify(value);
    response.writeHead(status, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    });
    response.end(body);
  }

  private listen(request: IncomingMessage, response: ServerResponse): void {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'MCP-Session-Id': this.sessionId,
    });
    response.write(': connected\n\n');
    const lastId = Number(request.headers['last-event-id'] ?? 0);
    for (const event of this.history) {
      if (event.id > lastId) this.writeEvent(response, event);
    }
    this.listeners.add(response);
    for (const resolve of this.listenerWaiters) resolve();
    this.listenerWaiters.clear();
    request.on('close', () => this.listeners.delete(response));
  }

  private async dispatch(message: JsonRpcRequest): Promise<unknown> {
    switch (message.method) {
      case 'initialize':
        return {
          protocolVersion: '2025-11-25',
          capabilities: {
            tools: { listChanged: true },
            resources: { subscribe: true, listChanged: true },
            logging: {},
            tasks: {},
          },
          serverInfo: { name: 'ax-event-demo', version: '1.0.0' },
        };
      case 'ping':
        return {};
      case 'tools/list':
        return {
          tools: [
            {
              name: 'start_reindex',
              description: 'Start a task-backed inventory reindex',
              inputSchema: {
                type: 'object',
                properties: { scope: { type: 'string' } },
              },
              execution: { taskSupport: 'required' },
            },
          ],
        };
      case 'prompts/list':
        return { prompts: [] };
      case 'tools/call': {
        const task = this.createTask();
        queueMicrotask(() =>
          this.notify('notifications/progress', {
            progressToken: task.taskId,
            progress: 0.25,
            total: 1,
            message: 'Reindex started',
          })
        );
        return { task };
      }
      case 'resources/list':
        return {
          resources: [...this.resources.values()],
        };
      case 'resources/templates/list':
        return {
          resourceTemplates: [
            {
              uriTemplate: 'demo://orders/{orderId}',
              name: 'Order by ID',
              description: 'A concrete order resource selected by ID',
              mimeType: 'application/json',
            },
          ],
        };
      case 'resources/read':
        return {
          contents: [
            {
              uri: String(message.params?.uri ?? 'demo://inventory'),
              mimeType: 'application/json',
              text: JSON.stringify({ widgets: 7, updatedAt: Date.now() }),
            },
          ],
        };
      case 'resources/subscribe':
        this.subscriptions.add(String(message.params?.uri));
        this.subscriptionCounts.set(
          String(message.params?.uri),
          (this.subscriptionCounts.get(String(message.params?.uri)) ?? 0) + 1
        );
        for (const resolve of this.subscriptionWaiters.get(
          String(message.params?.uri)
        ) ?? [])
          resolve();
        this.subscriptionWaiters.delete(String(message.params?.uri));
        return {};
      case 'resources/unsubscribe':
        this.subscriptions.delete(String(message.params?.uri));
        return {};
      case 'tasks/list':
        return { tasks: [...this.tasks.values()] };
      case 'tasks/get':
        return this.requireTask(String(message.params?.taskId));
      case 'tasks/result':
        return { result: { indexed: 42 } };
      case 'tasks/cancel': {
        const taskId = String(message.params?.taskId);
        this.updateTask(taskId, 'cancelled', 'Cancelled by client');
        return this.requireTask(taskId);
      }
      default:
        throw new Error(`Unsupported demo MCP method: ${message.method}`);
    }
  }

  private createTask(): DemoTask {
    const now = new Date().toISOString();
    const task: DemoTask = {
      taskId: randomUUID(),
      status: 'working',
      createdAt: now,
      lastUpdatedAt: now,
      ttl: null,
      pollInterval: 250,
    };
    this.tasks.set(task.taskId, task);
    for (const resolve of this.taskWaiters) resolve(task.taskId);
    this.taskWaiters.clear();
    return task;
  }

  private updateTask(
    taskId: string,
    status: DemoTask['status'],
    statusMessage: string
  ): void {
    const current = this.requireTask(taskId);
    const task = {
      ...current,
      status,
      statusMessage,
      lastUpdatedAt: new Date().toISOString(),
    };
    this.tasks.set(taskId, task);
    this.notify('notifications/tasks/status', { task });
  }

  private requireTask(taskId: string): DemoTask {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Unknown demo task ${taskId}`);
    return task;
  }

  private notify(method: string, params?: Record<string, unknown>): void {
    const event = {
      id: ++this.sequence,
      message: { jsonrpc: '2.0', method, ...(params ? { params } : {}) },
    };
    this.history.push(event);
    for (const response of this.listeners) this.writeEvent(response, event);
  }

  private writeEvent(
    response: ServerResponse,
    event: { id: number; message: unknown }
  ): void {
    response.write(`id: ${event.id}\n`);
    response.write(`data: ${JSON.stringify(event.message)}\n\n`);
  }

  private async readBody(request: IncomingMessage): Promise<string> {
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of request) {
      const value = Buffer.from(chunk);
      bytes += value.byteLength;
      if (bytes > 1024 * 1024) throw new Error('Demo MCP request too large');
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
  }
}

export async function waitForDemoSignal(
  signal: Promise<void>,
  label: string,
  timeoutMs = 15_000
): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      signal,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`Timed out waiting for ${label}`)),
          timeoutMs
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const server = new AxMCPEventDemoServer();
  console.log(await server.start(Number(process.env.PORT ?? 3001)));
}
