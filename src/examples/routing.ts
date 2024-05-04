import { AI, OpenAIArgs, Route, Router } from '../index.js';

const customerSupport = new Route('customerSupport', [
  'how can I return a product?',
  'where is my order?',
  'can you help me with a refund?',
  'I need to update my shipping address',
  'my product arrived damaged, what should I do?'
]);

const employeeHR = new Route('employeeHR', [
  'how do I request time off?',
  'where can I find the employee handbook?',
  'who do I contact for IT support?',
  'I have a question about my benefits',
  'how do I log my work hours?'
]);

const companyInfo = new Route('companyInfo', [
  'tell me about the company',
  'who are the company founders?',
  'what are the core values of our company?',
  'where are the companys offices located?',
  'what industries does our company operate in?'
]);

const salesInquiries = new Route('salesInquiries', [
  'I want to buy your products',
  'can you provide a quote?',
  'what are the payment options?',
  'how do I get a discount?',
  'who can I speak with for a bulk order?'
]);

const technicalSupport = new Route('technicalSupport', [
  'how do I install your software?',
  'I’m having trouble logging in',
  'can you help me configure my settings?',
  'my application keeps crashing',
  'how do I update to the latest version?'
]);

const ai = AI('openai', { apiKey: process.env.OPENAI_APIKEY } as OpenAIArgs);

const router = new Router(ai);
await router.setRoutes(
  [customerSupport, employeeHR, companyInfo, salesInquiries, technicalSupport],
  { filename: 'router.json' }
);

console.log(await router.forward('I need help with my order'));
console.log(await router.forward('I want to know more about the company'));
console.log(await router.forward('I need help installing your software'));
console.log(await router.forward('I want to buy your products'));
