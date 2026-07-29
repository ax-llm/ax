import type {
  AxMCPElicitationCreateParams,
  AxMCPElicitationCreateResult,
  AxMCPInputRequest,
  AxMCPInputResponse,
  AxMCPListRootsResult,
  AxMCPRoot,
  AxMCPSamplingCreateMessageParams,
  AxMCPSamplingCreateMessageResult,
} from './types.js';

export interface AxMCPInputRequestHandlers {
  roots?: readonly AxMCPRoot[];
  sampling?: (
    params: Readonly<AxMCPSamplingCreateMessageParams>
  ) =>
    | AxMCPSamplingCreateMessageResult
    | Promise<AxMCPSamplingCreateMessageResult>;
  elicitation?: (
    params: Readonly<AxMCPElicitationCreateParams>
  ) => AxMCPElicitationCreateResult | Promise<AxMCPElicitationCreateResult>;
}

/** Fulfills one MCP 2026-07-28 multi round-trip input request map. */
export async function axMCPFulfillInputRequests(
  inputRequests: Readonly<Record<string, AxMCPInputRequest>>,
  handlers: Readonly<AxMCPInputRequestHandlers>
): Promise<Record<string, AxMCPInputResponse>> {
  const responses: Record<string, AxMCPInputResponse> = {};

  await Promise.all(
    Object.entries(inputRequests).map(async ([key, request]) => {
      switch (request.method) {
        case 'roots/list': {
          if (!handlers.roots) {
            throw missingHandler(request.method);
          }
          const result: AxMCPListRootsResult = {
            roots: structuredClone([...handlers.roots]),
          };
          responses[key] = result;
          return;
        }
        case 'sampling/createMessage': {
          if (!handlers.sampling) {
            throw missingHandler(request.method);
          }
          responses[key] = await handlers.sampling(request.params);
          return;
        }
        case 'elicitation/create': {
          if (!handlers.elicitation) {
            throw missingHandler(request.method);
          }
          responses[key] = await handlers.elicitation(request.params);
          return;
        }
        default:
          throw new Error(
            `MCP protocol violation: unsupported MRTR input request method ${String((request as { method?: unknown }).method)}`
          );
      }
    })
  );

  return responses;
}

function missingHandler(method: string): Error {
  return new Error(
    `MCP protocol violation: server requested ${method} without a matching client handler`
  );
}
