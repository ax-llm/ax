import {
  AxAIOpenAIModel,
  AxJSRuntime,
  AxUCPClient,
  AxUCPWebhookEventSource,
  agent,
  ai,
  eventRoute,
  eventRuntime,
  eventTarget,
} from '@ax-llm/ax';

const ucp = new AxUCPClient({
  profileUrl: process.env.UCP_BUSINESS_PROFILE!,
  agentProfile: process.env.UCP_PLATFORM_PROFILE!,
});
const source = new AxUCPWebhookEventSource({
  client: ucp,
  identity: async (order) => lookupBuyerIdentity(order.checkout_id),
});
const llm = ai({
  name: 'openai',
  apiKey: process.env.OPENAI_API_KEY!,
  config: { model: AxAIOpenAIModel.GPT54Mini },
});
const runtime = eventRuntime({
  sources: [source],
  routes: [
    eventRoute({
      id: 'fulfilled-order-wake',
      match: { types: ['ucp.order.fulfilled'] },
      action: 'wake',
      requireAuthenticated: true,
      target: eventTarget({
        id: 'order-agent',
        ai: llm,
        program: agent('orderId:string -> followup:string', {
          runtime: new AxJSRuntime(),
        }),
        mapInput: ({ event }) => ({ orderId: event.subject! }),
      }),
    }),
  ],
});

await runtime.start();

// Mount this function in the application's HTTP framework. Hosting remains
// application-owned; verification and durable enqueue happen inside ingest().
export async function handleUCPWebhook(request: Request): Promise<Response> {
  await source.ingest(request);
  return new Response(null, { status: 202 });
}

async function lookupBuyerIdentity(checkoutId: string) {
  return { tenantId: 'shop', accountId: checkoutId };
}
