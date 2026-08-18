import {
  type AxAIDeploymentProfileArgs,
  type AxAIDeploymentProfileId,
  ai,
  axGetAIProfile,
} from '@ax-llm/ax';

const name = process.env.AX_PROFILE_NAME as AxAIDeploymentProfileId | undefined;
const model = process.env.AX_PROFILE_MODEL;
const apiKey = process.env.AX_PROFILE_API_KEY;
const apiURL = process.env.AX_PROFILE_API_URL;

if (!name || !model) {
  throw new Error(
    'Set AX_PROFILE_NAME and AX_PROFILE_MODEL; set AX_PROFILE_API_KEY and AX_PROFILE_API_URL when the selected profile requires them.'
  );
}

const profile = axGetAIProfile(name);
if (
  profile.transport !== 'openai-chat' ||
  [
    'openai',
    'openai-responses',
    'anthropic',
    'google-gemini',
    'webllm',
  ].includes(name)
) {
  throw new Error(
    'This generic smoke runner covers OpenAI-compatible deployment profiles.'
  );
}

const args: AxAIDeploymentProfileArgs = {
  name,
  apiKey,
  apiURL,
  config: { model, stream: false },
};
const service = ai(args);
const response = await service.chat({
  chatPrompt: [
    { role: 'user', content: 'Reply with exactly: profile smoke ok' },
  ],
});

console.log(JSON.stringify({ name, model, response }, null, 2));
