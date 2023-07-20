# LLMClient Apps

A collection of real world usecases for LLM client. We're working towards understanding how LLMs can replace entire backends.

```console
git clone https://github.com/dosco/llm-client
cd llm-client/examples
npm i
```

## Advanced Demos

### AI-Manager Bot: Generate Trello Tasks from Meeting Notes

Takes a transcript of a meeting conversation and automagically creates Trello tasks and assigns them to the right people. If people have not volunteered to handle tasks then they are assigned based on skills listed in their Trello Bio. What was previously a complex multiple hour job is done in 5 seconds. Due dates are assigned as well.

Create a `.env` file with the below values. The trello id's are easy to lookup just add a `.json` to the end of your trello board url and look for `id` and `list.id` in the json response.

```console
OPENAI_APIKEY="open-api-key"
TRELLO_APIKEY="trello-api-key"
TRELLO_APITOKEN="trello-api-token"
TRELLO_BOARD_ID="trello-board-id"
TRELLO_LIST_ID="trello-list-id"
```

```console
node meetings.js
```

Final Response:

```json
{
  "data": [
    {
      "id": "00b57daede7a",
      "name": "Frontend Development",
      "desc": "Implement the frontend based on the design mockups. Due by next Friday.",
      "workerName": "SW1"
    },
    {
      "id": "00b5c5b20",
      "name": "Backend Development - Business Logic",
      "desc": "Create the business logic for our API. Due by mid next week.",
      "workerName": "SW2"
    },
    {
      "id": "00b57bae3",
      "name": "Backend Development - Database and Cloud",
      "desc": "Design the database schema and manage the cloud services. Due by Tuesday next week.",
      "workerName": "SW3"
    },
    {
      "id": "00b57bb6d",
      "name": "Design Mockups",
      "desc": "Create the first drafts of the designs by end of day tomorrow and finalize them by Wednesday.",
      "workerName": "Designer"
    }
  ]
}
```

## Simple Demos

Here is a quick overview of the modules you will find in this project. To run these just include the LLM API Key in the commandline:

```shell
OPENAI_KEY=your-openai-auth-key node product-search.js
```

1. **ask-questions.js:** This script enables AI to utilize Google search to pinpoint correct answers, expanding the AI's knowledge base beyond static data.

2. **product-search.js:** Allows customers to pose product-related questions in natural language, improving customer experience and interaction.

3. **food-search.js:** Integrates multiple APIs to recommend the best dining options based on the user's preferences or location.

4. **customer-support.js:** Extracts valuable details from customer communications, making data analysis and customer feedback processing more efficient.

5. **marketing.js:** Uses AI to create succinct yet impactful marketing SMS messages, enhancing the effectiveness of your marketing strategies.

6. **transcribe-podcast.js:** Transcribes multiple podcast channels into text, making podcast content more accessible and searchable.

7. **chat-assistant.js:** A smart AI chatbot module capable of conducting intelligent conversations, ideal for customer service, user interaction, or simply for AI practice.

8. **get-summary.js:** Employs AI to condense a large block of text into a concise summary, which is useful for quick information absorption.

9. **ai-vs-ai.js:** A fascinating module where OpenAI engages in friendly banter with Cohere, providing unique insight into the interaction between different AI models.

10. **fibonacci.js** Generates code to compute the Fibonacci series and then uses the built-in JS code interpreter function to execute it.
