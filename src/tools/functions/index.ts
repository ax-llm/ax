// Function tools for Node.js environments
export {
  AxJSInterpreter,
  AxJSInterpreterPermission,
  axCreateJSInterpreter,
} from './jsInterpreter.js';

// AxRLMJSInterpreter moved to @ax-llm/ax (browser-compatible Web Worker implementation)
export {
  AxRLMJSInterpreter,
  AxRLMJSInterpreterPermission,
  axCreateRLMJSInterpreter,
} from '@ax-llm/ax';
