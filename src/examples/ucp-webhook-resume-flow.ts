import {
  AxUCPClient,
  AxUCPWebhookEventSource,
  eventRoute,
  eventRuntime,
} from '@ax-llm/ax';

const ucp = new AxUCPClient({
  profileUrl: process.env.UCP_BUSINESS_PROFILE!,
  agentProfile: process.env.UCP_PLATFORM_PROFILE!,
});
const source = new AxUCPWebhookEventSource({
  client: ucp,
  identity: { tenantId: 'shop' },
});
const runtime = eventRuntime({
  sources: [source],
  routes: [
    eventRoute({
      id: 'checkout-resume',
      match: { types: ['ucp.order.updated', 'ucp.order.fulfilled'] },
      action: 'resume',
      correlation: ({ event }) => ({
        kind: 'ucp.checkout',
        value: String(event.extensions?.checkoutid),
      }),
    }),
  ],
});

await runtime.start();

export async function handleUCPWebhook(request: Request): Promise<Response> {
  await source.ingest(request);
  return new Response(null, { status: 202 });
}
