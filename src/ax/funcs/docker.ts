import type { AxFunction } from '../ai/types.js'

export interface AxDockerContainer {
  Id: string
  Names: string[]
  Image: string
  ImageID: string
  Command: string
  Created: number
  State: {
    Status: string
    Running: boolean
    Paused: boolean
    Restarting: boolean
    OOMKilled: boolean
    Dead: boolean
    Pid: number
    ExitCode: number
    Error: string
    StartedAt: Date
    FinishedAt: Date
  }
  Status: string
  Ports: Array<{
    IP: string
    PrivatePort: number
    PublicPort: number
    Type: string
  }>
  Labels: { [key: string]: string }
  SizeRw: number
  SizeRootFs: number
  HostConfig: {
    NetworkMode: string
  }
  NetworkSettings: {
    Networks: {
      [key: string]: {
        IPAddress: string
        IPPrefixLen: number
        Gateway: string
        MacAddress: string
      }
    }
  }
  Mounts: Array<{
    Type: string
    Source: string
    Destination: string
    Mode: string
    RW: boolean
    Propagation: string
  }>
}

export class AxDockerSession {
  private readonly apiUrl: string
  private containerId: string | null = null

  constructor(apiUrl: string = 'http://localhost:2375') {
    this.apiUrl = apiUrl
  }

  async pullImage(imageName: string): Promise<void> {
    const response = await this.fetchDockerAPI(
      `/images/create?fromImage=${encodeURIComponent(imageName)}`,
      {
        method: 'POST',
      }
    )

    if (!response.ok) {
      throw new Error(`Failed to pull image: ${response.statusText}`)
    }

    // Wait for the pull to complete
    await response.text()
  }

  async createContainer({
    imageName,
    volumes = [],
    doNotPullImage,
    tag,
  }: Readonly<{
    imageName: string
    volumes?: Array<{ hostPath: string; containerPath: string }>
    doNotPullImage?: boolean
    tag?: string
  }>) {
    const binds = volumes.map((v) => `${v.hostPath}:${v.containerPath}`)

    if (!doNotPullImage) {
      await this.pullImage(imageName)
    }

    const containerConfig = {
      Image: imageName,
      Tty: true,
      OpenStdin: false,
      AttachStdin: false,
      AttachStdout: false,
      AttachStderr: false,
      HostConfig: { Binds: binds },
      Labels: {} as Record<string, string>,
    }

    if (tag) {
      containerConfig.Labels['com.example.tag'] = tag
    }

    const response = await this.fetchDockerAPI(`/containers/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(containerConfig),
    })

    if (!response.ok) {
      throw new Error(`Failed to create container: ${response.statusText}`)
    }

    const data = (await response.json()) as { Id: string }
    this.containerId = data.Id

    return data
  }

  async findOrCreateContainer({
    imageName,
    volumes = [],
    doNotPullImage,
    tag,
  }: Readonly<{
    imageName: string
    volumes?: Array<{ hostPath: string; containerPath: string }>
    doNotPullImage?: boolean
    tag: string
  }>): Promise<{ Id: string; isNew: boolean }> {
    // First, try to find existing containers with the given tag
    const existingContainers = await this.listContainers(true)
    const matchingContainers = existingContainers.filter(
      (container) =>
        container.Labels && container.Labels['com.example.tag'] === tag
    )

    if (matchingContainers && matchingContainers.length > 0) {
      // Randomly select a container from the matching ones
      const randomIndex = Math.floor(Math.random() * matchingContainers.length)
      const selectedContainer = matchingContainers[randomIndex]

      if (selectedContainer) {
        // Connect to the selected container
        await this.connectToContainer(selectedContainer.Id)
        return { Id: selectedContainer.Id, isNew: false }
      }
    }

    // If no container with the tag exists, create a new one
    const newContainer = await this.createContainer({
      imageName,
      volumes,
      doNotPullImage,
      tag,
    })

    return { Id: newContainer.Id, isNew: true }
  }

  async startContainer(): Promise<void> {
    if (!this.containerId) {
      throw new Error('No container created or connected')
    }

    const response = await this.fetchDockerAPI(
      `/containers/${this.containerId}/start`,
      {
        method: 'POST',
      }
    )

    if (!response.ok) {
      throw new Error(`Failed to start container: ${response.statusText}`)
    }
  }

  async connectToContainer(containerId: string): Promise<void> {
    const response = await this.fetchDockerAPI(
      `/containers/${containerId}/json`
    )

    if (!response.ok) {
      throw new Error(`Failed to connect to container: ${response.statusText}`)
    }

    this.containerId = containerId
  }

  async stopContainers({
    tag,
    remove,
    timeout = 10,
  }: Readonly<{ tag?: string; remove?: boolean; timeout?: number }>): Promise<
    Array<{ Id: string; Action: 'stopped' | 'removed' }>
  > {
    const results: Array<{ Id: string; Action: 'stopped' | 'removed' }> = []

    // List all containers
    const containers = await this.listContainers(true)

    // Filter containers by tag if provided
    const targetContainers = tag
      ? containers.filter(
          (container) => container.Labels['com.example.tag'] === tag
        )
      : containers

    for (const container of targetContainers) {
      // Stop the container if it's running
      if (container.State.Status === 'running') {
        const stopResponse = await this.fetchDockerAPI(
          `/containers/${container.Id}/stop?t=${timeout}`,
          { method: 'POST' }
        )

        if (!stopResponse.ok) {
          console.warn(
            `Failed to stop container ${container.Id}: ${stopResponse.statusText}`
          )
          continue
        }

        results.push({ Id: container.Id, Action: 'stopped' })
      }

      // Remove the container if the remove flag is set
      if (remove) {
        const removeResponse = await this.fetchDockerAPI(
          `/containers/${container.Id}`,
          { method: 'DELETE' }
        )

        if (!removeResponse.ok) {
          console.warn(
            `Failed to remove container ${container.Id}: ${removeResponse.statusText}`
          )
          continue
        }

        results.push({ Id: container.Id, Action: 'removed' })
      }
    }

    return results
  }

  async listContainers(all: boolean = false): Promise<AxDockerContainer[]> {
    const response = await this.fetchDockerAPI(`/containers/json?all=${all}`, {
      method: 'GET',
    })
    return response.json() as Promise<AxDockerContainer[]>
  }

  async getContainerLogs(): Promise<string> {
    if (!this.containerId) {
      throw new Error('No container created or connected')
    }
    const response = await this.fetchDockerAPI(
      `/containers/${this.containerId}/logs?stdout=true&stderr=true`,
      { method: 'GET' }
    )
    return response.text()
  }

  async executeCommand(command: string) {
    console.log('Executing command:', command)

    if (!this.containerId) {
      throw new Error('No container created or connected')
    }

    // Check container state
    const containerInfo = await this.getContainerInfo(this.containerId)

    if (containerInfo.State.Status !== 'running') {
      await this.startContainer()

      // Wait for the container to be in the "running" state
      await this.waitForContainerToBeRunning(this.containerId)
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
          AttachStderr: true,
        }),
      }
    )

    if (!createResponse.ok) {
      throw new Error(
        `Failed to create exec instance: ${createResponse.statusText}`
      )
    }

    const execData = (await createResponse.json()) as { Id: string }

    // Start exec instance
    const startResponse = await this.fetchDockerAPI(
      `/exec/${execData.Id}/start`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          Detach: false,
          Tty: false,
        }),
      }
    )

    if (!startResponse.ok) {
      throw new Error(
        `Failed to start exec instance: ${startResponse.statusText}`
      )
    }

    // Return the output
    return await startResponse.text()
  }

  // Add these new methods to the class:

  private async getContainerInfo(
    containerId: string
  ): Promise<AxDockerContainer> {
    const response = await this.fetchDockerAPI(
      `/containers/${containerId}/json`
    )
    if (!response.ok) {
      throw new Error(`Failed to get container info: ${response.statusText}`)
    }
    return response.json() as Promise<AxDockerContainer>
  }

  private async waitForContainerToBeRunning(
    containerId: string,
    timeout: number = 30000
  ): Promise<void> {
    const startTime = Date.now()
    while (Date.now() - startTime < timeout) {
      const containerInfo = await this.getContainerInfo(containerId)
      if (containerInfo.State.Status === 'running') {
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 1000)) // Wait for 1 second before checking again
    }
    throw new Error('Timeout waiting for container to start')
  }

  private async fetchDockerAPI(
    endpoint: string,
    options?: Readonly<RequestInit>
  ): Promise<Response> {
    const url = new URL(endpoint, this.apiUrl).toString()
    return await fetch(url, options)
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
              'Shell command to execute. eg. `ls -l` or `echo "Hello, World!"`.',
          },
        },
        required: ['command'],
      },

      func: async ({ command }: Readonly<{ command: string }>) =>
        await this.executeCommand(command),
    }
  }
}
