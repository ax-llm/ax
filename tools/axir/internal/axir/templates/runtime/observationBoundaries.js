// Shared by the embedded JavaScript runtimes. Core owns tool result policy
// and the pending observation. The runtime owns the code boundary and REPL
// bindings, including when generated code catches a pause.
const __ax_discovery_pause = Object.freeze(new Error("Discovery needs a new model turn."));
let __ax_discovery_paused = false;
let __ax_observation_callback = null;

function __ax_reset_observation_turn(guard) {
  __ax_discovery_paused = false;
  __ax_observation_callback = guard;
}

function __ax_before_observation_action(action) {
  if (__ax_discovery_paused) throw __ax_discovery_pause;
  if (__ax_observation_callback) __ax_observation_callback({ action });
}

function __ax_pause_after_discovery(payload) {
  if (__ax_observation_callback && (payload.kind === "discover" || payload.kind === "recall")) {
    __ax_discovery_paused = true;
    throw __ax_discovery_pause;
  }
}

function __ax_persist_actor_body(code, suffix, observationBoundaries) {
  if (!observationBoundaries || !suffix) return code + "\n" + suffix;
  // Capture lexical bindings from inside the try block. The existing suffix
  // skips bindings that were never initialized because the actor paused.
  let persist = "__ax_persist_turn";
  while (code.includes(persist)) persist += "_";
  return "let " + persist + "; try { " + persist + " = () => { " + suffix +
    " };\n" + code + "\n} finally { " + persist + "(); }";
}
