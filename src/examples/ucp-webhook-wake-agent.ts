import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  AxAIOpenAIModel,
  AxJSRuntime,
  AxUCPClient,
  AxUCPWebhookEventSource,
  agent,
  ai,
  eventPath,
  eventRoute,
  eventRuntime,
  eventTarget,
  s,
} from '@ax-llm/ax';
import {
  AX_SQLITE_EVENT_STANDARD_RETENTION,
  AxSQLiteEventStore,
} from '@ax-llm/ax-tools/event/sqlite';

const databasePath =
  process.env.AX_EVENT_DB_PATH ?? './.data/ucp-webhook-wake.sqlite';
await mkdir(dirname(databasePath), { recursive: true });
const store = new AxSQLiteEventStore({
  filename: databasePath,
  retention: AX_SQLITE_EVENT_STANDARD_RETENTION,
});

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
const orderAgentSignature = s('orderId:string -> followup:string');
const orderAgentTarget = eventTarget('order-agent')
  .createProgram(orderAgentSignature, () =>
    agent(orderAgentSignature, { runtime: new AxJSRuntime() })
  )
  .ai(llm)
  .input((input) => input.field('orderId', eventPath.subject()))
  .build();
const runtime = eventRuntime({
  store,
  programStateStore: store,
  sources: [source],
  routes: [
    eventRoute('fulfilled-order-wake')
      .types('ucp.order.fulfilled')
      .authenticated()
      .instanceKey(eventPath.subject())
      .wake(orderAgentTarget)
      .build(),
  ],
});

await runtime.start();

// Mount this function in the application's HTTP framework. Hosting remains
// application-owned; verification and durable enqueue happen inside ingest().
export async function handleUCPWebhook(request: Request): Promise<Response> {
  const receipt = await source.ingest(request);
  if (!receipt.accepted) return new Response(null, { status: 503 });
  return new Response(null, { status: 202 });
}

export async function closeUCPWebhookRuntime(): Promise<void> {
  await runtime.close();
  await store.close();
}

async function lookupBuyerIdentity(checkoutId: string) {
  return { tenantId: 'shop', accountId: checkoutId };
}
