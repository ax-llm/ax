---
title: Use in production 
description: How to build and deploy Ax apps.
---


Here’s a markdown documentation page that shows how to build a Node.js TypeScript backend API for answering business questions using Ax:

# Building a Business Q&A API with Ax and Node.js

This guide demonstrates creating a Node.js TypeScript backend API to answer business questions using the Ax library. The API will utilize OpenAI for natural language processing and Weaviate as a vector database for efficient information retrieval.

## Table of Contents

1. [Project Initialization](#project-initialization)
2. [Code Implementation](#code-implementation)
3. [Docker Image Creation](#docker-image-creation)
4. [Building and Deploying to Google Cloud Run](#building-and-deploying-to-google-cloud-run)
5. [Secrets Management](#secrets-management)

## Project Initialization

To get started, follow these steps to set up your project:

1. Create a new directory for your project:
   ```bash
   mkdir business-qa-api && cd business-qa-api
   ```

2. Initialize a new Node.js project:
   ```bash
   npm init -y
   ```

3. Install the necessary dependencies:
   ```bash
   npm install @ax-llm/ax hono tsx dotenv
   npm install --save-dev typescript @types/node
   ```

4. Create a `tsconfig.json` file:
   ```bash
   npx tsc --init
   ```

5. Create a `src` directory and an `index.ts` file inside it:
   ```bash
   mkdir src && touch src/index.ts
   ```

6. Create a `.env` file in the root directory to store your environment variables:
   ```bash
   touch .env
   ```

## Code Implementation

Add the following code to your `src/index.ts` file:

```typescript
import { AxAI, AxDBManager, AxDBWeaviate, AxRAG } from '@ax-llm/ax';
import { Hono } from 'hono';

// Initialize the AI with the API key
const ai = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY as string
});

// Initialize a vector db
const db = new AxDBWeaviate({
    apiKey: process.env.WEAVIATE_APIKEY as string,
    host: process.env.WEAVIATE_HOST as string
});

// Manager for handling database operations with AI
const manager = new AxDBManager({ ai, db });

// Function to fetch answers from the vector database
const fetchFromVectorDB = async (query: string): Promise<string> => {
  const matches = await manager.query(query);
  return (
    matches
      .at(0)
      ?.slice(0, 3)
      ?.map((match) => match.text)
      ?.join('\n') ?? 'No answers found'
  );
};

// Initialize Hono app
const app = new Hono();

// Endpoint to get questions and return answers
app.post('/get-answer', async (c) => {
  // RAG instance for processing queries using recursive answers generation
  const rag = new AxRAG(ai, fetchFromVectorDB, { maxHops: 1 });

  // Extract question from request body
  const question = c.req.body.question;

  // Validate question presence
  if (!question) {
    return c.json({ error: 'Question is required' }, 400);
  }

  try {
    // Process the question using RAG
    const answer = await rag.forward({ question });

    // Return the answer in JSON format
    return c.json({ answer });
  } catch (error) {
    // Handle possible errors
    return c.json({ error: 'Failed to fetch answer' }, 500);
  }
});

// Start the server
app.listen({ port: 3000 });
```

To run the application, use the following command:

```bash
node --env-file=.env --import=tsx src/index.ts
```


## Test your new API

```shell
curl -X POST http://localhost:3000/get-answer \
     -H "Content-Type: application/json" \
     -d '{"question": "List 3 of the top most important work done by Michael Stonebraker?"}'
```

## Docker Image Creation

To containerize your application, create a `Dockerfile` in the root directory:

```dockerfile
# Use an official Node.js runtime as the base image
FROM node:18

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json to the working directory
COPY package*.json ./

# Install the application dependencies
RUN npm install

# Copy the application source code to the working directory
COPY . .

# Expose the port the app runs on
EXPOSE 3000

# Define the command to run the application
CMD ["node", "--env-file=.env", "--import=tsx", "src/index.ts"]
```

Build the Docker image:

```bash
docker build -t business-qa-api .
```

## Building and Deploying to Google Cloud Run

1. Install and set up the Google Cloud SDK.

2. Authenticate with Google Cloud:
   ```bash
   gcloud auth login
   ```

3. Set your project ID:
   ```bash
   gcloud config set project YOUR_PROJECT_ID
   ```

4. Build and push the Docker image to Google Container Registry:
   ```bash
   gcloud builds submit --tag gcr.io/YOUR_PROJECT_ID/business-qa-api
   ```

5. Deploy to Google Cloud Run:
   ```bash
   gcloud run deploy business-qa-api \
     --image gcr.io/YOUR_PROJECT_ID/business-qa-api \
     --platform managed \
     --region us-central1 \
     --allow-unauthenticated
   ```

## Secrets Management

For managing secrets in Google Cloud Run:

1. Store your secrets in Google Secret Manager:
   ```bash
   echo -n "your-openai-api-key" | gcloud secrets create OPENAI_APIKEY --data-file=-
   echo -n "your-weaviate-api-key" | gcloud secrets create WEAVIATE_APIKEY --data-file=-
   echo -n "your-weaviate-host" | gcloud secrets create WEAVIATE_HOST --data-file=-
   ```

2. Grant the Cloud Run service account access to the secrets:
   ```bash
   gcloud run services update business-qa-api \
     --set-secrets=OPENAI_APIKEY=OPENAI_APIKEY:latest,WEAVIATE_APIKEY=WEAVIATE_APIKEY:latest,WEAVIATE_HOST=WEAVIATE_HOST:latest
   ```

3. Update your `Dockerfile` to use the secrets:
   ```dockerfile
   # ... (previous Dockerfile content)

   # Use secrets in the command
   CMD ["sh", "-c", "OPENAI_APIKEY=$OPENAI_APIKEY WEAVIATE_APIKEY=$WEAVIATE_APIKEY WEAVIATE_HOST=$WEAVIATE_HOST node --import=tsx src/index.ts"]
   ```

4. Redeploy your application to apply the changes.

This setup ensures that your sensitive information is securely managed and accessible to your application in Google Cloud Run.

