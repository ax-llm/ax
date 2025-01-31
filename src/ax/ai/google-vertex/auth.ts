import { GoogleAuth } from 'google-auth-library'
import type {
  GoogleAuthOptions,
  JSONClient,
} from 'google-auth-library/build/src/auth/googleauth.js'

/**
 * This class is used to authenticate with the Google Vertex AI API.
 */
export class GoogleVertexAuth {
  private auth: GoogleAuth
  private client?: JSONClient

  constructor(config: GoogleAuthOptions = {}) {
    this.auth = new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
      ...config,
    })
  }

  async getAuthenticatedClient() {
    if (!this.client) {
      this.client = (await this.auth.getClient()) as JSONClient
    }
    return this.client
  }

  async getAccessToken() {
    const client = await this.getAuthenticatedClient()
    const response = await client.getAccessToken()
    if (!response.token) {
      throw new Error('Failed to obtain access token')
    }
    return response.token
  }
}
