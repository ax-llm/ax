# TypeScript API removals in Ax 25.0.0

Remove `responseFormatWithFunctions` from provider feature declarations and mock
service configurations. The flag has been ignored since 24.0.24. Set
`structuredOutputMode: 'function'` on the Ax program when the provider requires
function-based structured output alongside tools. Otherwise keep the current
`auto` default.

`AxAIProfileAuthentication.type` no longer accepts `api-key-query`. No shipped
profile uses it, and query-key authentication was never implemented. Configure
one of the supported authentication methods: `bearer`, `api-key-header`,
`x-api-key`, or `none`, according to the provider's actual contract.
