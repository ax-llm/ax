import { ai, ax, AxAIGoogleGeminiModel } from '@ax-llm/ax';

export const mapsDemo = ax(
  'userQuestion:string "User location-aware question" -> responseText:string "AI response"'
);

console.log('=== Google Maps Grounding Demo ===');

const llm = ai({
  name: 'google-gemini',
  apiKey: process.env.GOOGLE_APIKEY!,
  model: AxAIGoogleGeminiModel.Gemini25FlashLite,
  options: {
    googleMaps: true,
    googleMapsRetrieval: {
      latLng: { latitude: 34.050481, longitude: -118.248526 },
      enableWidget: true,
    },
  },
});

const res = await mapsDemo.forward(llm, {
  userQuestion:
    'What are the best Italian restaurants within a 15-minute walk from here?',
});

console.log(res.responseText);
