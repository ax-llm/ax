import { ai, ax } from '@ax-llm/ax';

const imageAnalyzer = ax(`
  images:image[] "Multiple images to analyze" ->
  descriptions:string[] "Description for each image",
  commonThemes:string[] "Common themes across all images"
`);

const llm = ai({
  name: 'openai',
  apiKey: process.env.OPENAI_API_KEY!,
});

// Sample base64 images (small placeholder images)
const sampleImages = [
  {
    mimeType: 'image/jpeg',
    data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+P+/HgAFhAJ/wlseKgAAAABJRU5ErkJggg==', // 1x1 pixel JPEG
  },
  {
    mimeType: 'image/png',
    data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', // 1x1 pixel PNG
  },
];

async function testImageArrays() {
  console.log('Testing image arrays with OpenAI...');

  try {
    const result = await imageAnalyzer.forward(llm, {
      images: sampleImages,
    });

    console.log('✅ Image arrays work!');
    console.log('Descriptions:', result.descriptions);
    console.log('Common themes:', result.commonThemes);
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

testImageArrays();
