import { GoogleAuth } from 'google-auth-library'
import type {
  GoogleAuthOptions,
  JSONClient,
} from 'google-auth-library/build/src/auth/googleauth.js'
import type { GetAccessTokenResponse } from 'google-auth-library/build/src/auth/oauth2client.js'

/**
 * This class is used to authenticate with the Google Vertex AI API.
 */
export class GoogleVertexAuth {
  private auth: GoogleAuth
  private client?: JSONClient
  private currentToken?: string
  private tokenExpiry?: number

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
    // Check if we have a valid cached token
    if (
      this.currentToken &&
      this.tokenExpiry &&
      Date.now() < this.tokenExpiry
    ) {
      return this.currentToken
    }

    const client = await this.getAuthenticatedClient()
    const tokenResponse = await client.getAccessToken()

    // Cache the token
    this.currentToken = tokenResponse.token ?? undefined

    // Set expiry
    const expiry = this.getExpiry(tokenResponse)

    // Set expiry 5 minutes before actual expiry to be safe
    const fiveMinutes = 5 * 60 * 1000
    this.tokenExpiry = expiry - fiveMinutes

    return this.currentToken
  }

  /**
   * Get the expiry date from the token response.
   */
  getExpiry(tokenResponse: GetAccessTokenResponse) {
    // Default to 1 hour (the typical expiry for a token)
    const oneHour = 3600 * 1000
    let expiry = Date.now() + oneHour

    let responseExpiry = tokenResponse.res?.data?.expiry_date
    if (responseExpiry) {
      if (typeof responseExpiry === 'number') {
        expiry = responseExpiry
      } else if (responseExpiry instanceof Date) {
        expiry = responseExpiry.getTime()
      } else if (typeof responseExpiry === 'string') {
        expiry = new Date(responseExpiry).getTime()
      } else {
        console.warn('Unknown expiry type', responseExpiry)
      }
    } else {
      console.warn('No expiry date found in response', tokenResponse.res?.data)
    }

    return expiry
  }
}
