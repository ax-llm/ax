// import * as chrono from 'chrono-node';
// import superagent from 'superagent';
// import chalk from 'chalk';
// import 'dotenv/config';

// const trelloApiKey = process.env.TRELLO_APIKEY;
// const trelloApiToken = process.env.TRELLO_APITOKEN;

// const trelloBoardID = process.env.TRELLO_BOARD_ID; // test
// const trelloNewTasksListID = process.env.TRELLO_LIST_ID; // todo

// const findWorker = async ({ query }) => {
//   const res = await superagent
//     .get(`https://api.trello.com/1/search/members`)
//     .query({
//       key: trelloApiKey,
//       token: trelloApiToken,
//     })
//     .query({
//       query,
//       idBoard: trelloBoardID,
//       modelTypes: 'members',
//       memberFields: 'id,fullName,bio,',
//       limit: 1,
//     })
//     .set('Accept', 'application/json')
//     .catch(({ message }) => {
//       throw new Error(message);
//     });

//   const members = res.body?.map(({ id, fullName, bio }) => {
//     id, fullName, bio;
//   });
//   return members;
// };

// const createTask = async ({ name, desc, dueDate, idMembers }) => {
//   const chronoResults = chrono.parseDate(dueDate);
//   const due = chronoResults?.toISOString();

//   const res = await superagent
//     .post(`https://api.trello.com/1/cards`)
//     .query({
//       key: trelloApiKey,
//       token: trelloApiToken,
//     })
//     .query({
//       idList: trelloNewTasksListID,
//       idBoard: trelloBoardID,
//       name,
//       desc,
//       due,
//       idMembers,
//     })
//     .set('Accept', 'application/json')
//     .catch(({ message }) => {
//       throw new Error(message);
//     });

//   const { id, name: cardName } = res.body;
//   return { id, cardName };
// };

// // List of functions available to the AI
// const functions = [
//   {
//     name: 'findWorker',
//     description: 'Find worker by name or skill',
//     parameters: {
//       type: 'object',
//       properties: {
//         query: {
//           type: 'string',
//           description: 'Name or skill of worker',
//           maxLength: 16384,
//         },
//       },
//       required: ['query'],
//     },
//     func: findWorker,
//   },
//   {
//     name: 'createTask',
//     description: 'Create task',
//     parameters: {
//       type: 'object',
//       properties: {
//         name: {
//           type: 'string',
//           description: 'Task name',
//         },
//         desc: {
//           type: 'string',
//           description: 'Task description',
//         },
//         dueDate: {
//           type: 'string',
//           description: 'Task due date',
//         },
//         idMembers: {
//           type: 'string',
//           description:
//             'Comma-separated list of worker IDs to assign this task to',
//         },
//       },
//       required: ['name', 'desc'],
//     },
//     func: createTask,
//   },
// ];

// const responseSchema = {
//   type: 'object',
//   properties: {
//     data: {
//       type: 'array',
//       items: {
//         type: 'object',
//         properties: {
//           id: { type: 'string' },
//           name: { type: 'string' },
//           desc: { type: 'string' },
//           workerName: { type: 'string' },
//         },
//       },
//     },
//     error: {
//       type: 'string',
//     },
//   },
// };

// const prompt = new SPrompt(responseSchema, functions);
// prompt.setDebug(true);

// const meetingNotes = `
// Manager: Alright, team. As we discussed in the last standup, we're working on building a todo list app. Let's finalize who's taking care of what and when we expect it done. I want to start by asking, do we all understand the basics of the project?

// SW1, SW2, SW3, Designer: (in unison) Yes.

// Manager: Great! Let's start with the frontend. SW1, since you are our UI engineer, you will be working on the frontend. We need to ensure it is user-friendly, responsive, and aesthetically pleasing. The Designer will provide you with the design mockups. Designer, when can we have the design finalized?

// Designer: I can have the first drafts of the designs ready by end of day tomorrow, and based on feedback, we can finalize it by Wednesday.

// Manager: Sounds good. SW1, once the designs are ready, you can start implementing them. Let's have the frontend ready by next Friday.

// SW1: Understood. I'll start working on setting up the base frontend code and incorporate the designs as soon as they're finalized.

// Manager: Excellent. Now, for the backend. SW2 and SW3, you will be working together to develop the API endpoints and set up the database. SW2, you will focus on creating the business logic for our API.

// SW2: Alright, I can start with basic CRUD operations for the todo items. I should be able to have them ready for initial testing by mid next week.

// Manager: Good, we want those ready for SW1 to integrate with the frontend. Now, SW3, you'll be responsible for the database schema and managing the cloud services.

// SW3: Okay, I'll design the schema keeping scalability in mind, and set up our servers on the cloud. I think by Tuesday next week, we should have a basic version up and running.

// Manager: That's excellent. SW2 and SW3, I expect the backend to be functional by end of next week so that SW1 has ample time for integration. Let's keep the communication lines open to ensure we are all on the same page. Is everyone clear on their responsibilities and deadlines?

// SW1, SW2, SW3, Designer: (in unison) Yes.

// Manager: Perfect! Let's create a great todo list app, folks. Thank you.
// `;

// const promptText = `
// Use the below meeting notes to first find workers by name or if not provided then skill and then create tasks for these workers.

// Meeting Notes:
// ${meetingNotes}
// `;

// const conf = OpenAIDefaultOptions();
// // conf.model = OpenAIGenerateModel.GPT4;
// const ai = new OpenAI(process.env.OPENAI_APIKEY, conf);

// const res = await prompt.generate(ai, promptText);
// console.log(chalk.green(JSON.stringify(res.value(), null, 2)));
