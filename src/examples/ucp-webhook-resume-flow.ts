import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  AxAIOpenAIModel,
  AxPushEventSource,
  AxUCPClient,
  AxUCPWebhookEventSource,
  ai,
  ax,
  eventPath,
  eventRoute,
  eventRuntime,
  eventTarget,
  flow,
} from '@ax-llm/ax';
import {
  AX_SQLITE_EVENT_STANDARD_RETENTION,
  AxSQLiteEventStore,
} from '@ax-llm/ax-tools/event/sqlite';

const databasePath =
  process.env.AX_EVENT_DB_PATH ?? './.data/ucp-webhook-resume.sqlite';
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
  identity: { tenantId: 'shop' },
});
const checkoutStarted = new AxPushEventSource('checkout-started');
const llm = ai({
  name: 'openai',
  apiKey: process.env.OPENAI_API_KEY!,
  config: { model: AxAIOpenAIModel.GPT54Mini },
});
const checkoutFlow = flow<{ checkoutId: string; eventType: string }>()
  .description(
    'Checkout lifecycle',
    'Summarize checkout state when an application event wakes the flow or a UCP webhook resumes it.'
  )
  .node('summarize', ax('checkoutId:string, eventType:string -> status:string'))
  .execute('summarize', (state) => ({
    checkoutId: state.checkoutId,
    eventType: state.eventType,
  }))
  .returns((state) => ({ status: state.summarizeResult.status as string }));
const checkoutTarget = eventTarget('checkout-flow')
  .program(checkoutFlow)
  .ai(llm)
  .wakeInput((input) =>
    input
      .field('checkoutId', eventPath.data('checkoutId'))
      .field('eventType', eventPath.constant('started'))
  )
  .resumeInput((input) =>
    input
      .field('checkoutId', eventPath.continuation('checkoutId'))
      .field('eventType', eventPath.type())
  )
  .waitFor('ucp.checkout', eventPath.data('checkoutId'), {
    metadata: { checkoutId: eventPath.data('checkoutId') },
  })
  .retrySafety('idempotent')
  .build();
const runtime = eventRuntime({
  store,
  programStateStore: store,
  sources: [checkoutStarted, source],
  routes: [
    eventRoute('checkout-start')
      .types('app.checkout.started')
      .instanceKey(eventPath.data('checkoutId'))
      .wake(checkoutTarget)
      .build(),
    eventRoute('checkout-resume')
      .types('ucp.order.updated', 'ucp.order.fulfilled')
      .correlate('ucp.checkout', eventPath.extension('checkoutid'))
      .resume(checkoutTarget)
      .build(),
  ],
});

await runtime.start();

export async function beginCheckout(checkoutId: string): Promise<void> {
  await checkoutStarted.publish({
    event: {
      specversion: '1.0',
      id: `checkout-start:${checkoutId}`,
      source: 'app://checkout',
      type: 'app.checkout.started',
      subject: checkoutId,
      data: { checkoutId },
    },
    identity: { tenantId: 'shop' },
    trust: 'authenticated',
  });
}

export async function handleUCPWebhook(request: Request): Promise<Response> {
  const receipt = await source.ingest(request);
  if (!receipt.accepted) return new Response(null, { status: 503 });
  return new Response(null, { status: 202 });
}

export async function closeUCPWebhookRuntime(): Promise<void> {
  await runtime.close();
  await store.close();
}
