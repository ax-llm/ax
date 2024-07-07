import type { AxFunction } from '../ai/types.js';

export class AxDockerSession {
  private readonly apiUrl: string;
  private containerId: string | null = null;

  constructor(apiUrl: string = 'http://localhost:2375') {
    this.apiUrl = apiUrl;
  }

  async pullImage(imageName: string): Promise<void> {
    const response = await this.fetchDockerAPI(
      `/images/create?fromImage=${encodeURIComponent(imageName)}`,
      {
        method: 'POST'
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to pull image: ${response.statusText}`);
    }

    // Wait for the pull to complete
    await response.text();
  }

  async createContainer({
    imageName,
    volumes = [], // Example format: [{ hostPath: '/host/path', containerPath: '/container/path' }]
    doNotPullImage
  }: Readonly<{
    imageName: string;
    volumes?: Array<{ hostPath: string; containerPath: string }>;
    doNotPullImage?: boolean;
  }>) {
    const binds = volumes.map((v) => `${v.hostPath}:${v.containerPath}`);

    if (!doNotPullImage) {
      await this.pullImage(imageName);
    }

    const response = await this.fetchDockerAPI(`/containers/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        Image: imageName,
        Tty: true,
        OpenStdin: false,
        AttachStdin: false,
        AttachStdout: false,
        AttachStderr: false,
        HostConfig: { Binds: binds }
      })
    });

    if (!response.ok) {
      throw new Error(`Failed to create container: ${response.statusText}`);
    }

    const data = (await response.json()) as { Id: string };
    this.containerId = data.Id;

    return data;
  }

  async startContainer(): Promise<void> {
    if (!this.containerId) {
      throw new Error('No container created or connected');
    }

    const response = await this.fetchDockerAPI(
      `/containers/${this.containerId}/start`,
      {
        method: 'POST'
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to start container: ${response.statusText}`);
    }
  }

  async connectToContainer(containerId: string): Promise<void> {
    const response = await this.fetchDockerAPI(
      `/containers/${containerId}/json`
    );

    if (!response.ok) {
      throw new Error(`Failed to connect to container: ${response.statusText}`);
    }

    this.containerId = containerId;
  }

  async executeCommand(command: string) {
    if (!this.containerId) {
      throw new Error('No container created or connected');
    }

    // Create exec instance
    const createResponse = await this.fetchDockerAPI(
      `/containers/${this.containerId}/exec`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          Cmd: ['sh', '-c', command],
          AttachStdout: true,
          AttachStderr: true
        })
      }
    );

    if (!createResponse.ok) {
      throw new Error(
        `Failed to create exec instance: ${createResponse.statusText}`
      );
    }

    const execData = (await createResponse.json()) as { Id: string };

    // Start exec instance
    const startResponse = await this.fetchDockerAPI(
      `/exec/${execData.Id}/start`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          Detach: false,
          Tty: false
        })
      }
    );

    if (!startResponse.ok) {
      throw new Error(
        `Failed to start exec instance: ${startResponse.statusText}`
      );
    }

    // Return the output
    return await startResponse.text();
  }

  async stopContainer() {
    if (!this.containerId) {
      throw new Error('No container created or connected');
    }

    const response = await this.fetchDockerAPI(
      `/containers/${this.containerId}/stop`,
      {
        method: 'POST'
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to stop container: ${response.statusText}`);
    }
  }

  async listContainers(all: boolean = false) {
    const response = await this.fetchDockerAPI(`/containers/json?all=${all}`, {
      method: 'GET'
    });
    return response.json();
  }

  async getContainerLogs(): Promise<string> {
    if (!this.containerId) {
      throw new Error('No container created or connected');
    }
    const response = await this.fetchDockerAPI(
      `/containers/${this.containerId}/logs?stdout=true&stderr=true`,
      { method: 'GET' }
    );
    return response.text();
  }

  private async fetchDockerAPI(
    endpoint: string,
    options?: Readonly<RequestInit>
  ): Promise<Response> {
    const url = new URL(endpoint, this.apiUrl).toString();
    return await fetch(url, options);
  }

  public toFunction(): AxFunction {
    return {
      name: 'commandExecution',
      description:
        'Use this function to execute shell commands, scripts, and programs. This function enables interaction with the file system, running system utilities, and performing tasks that require a shell interface.',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description:
              'Shell command to execute. eg. `ls -l` or `echo "Hello, World!"`.'
          }
        },
        required: ['command']
      },

      func: this.executeCommand
    };
  }
}
