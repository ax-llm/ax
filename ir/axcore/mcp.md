# MCP timeout and listening cleanup

The five generated clients implement ping as a synchronous request. They do not
create the JavaScript ping Promise.race timeout or install its temporary abort
listener. Request cancellation and pending ownership are covered by each native
WebSocket/HTTP cleanup suite, including success, send failure, cancellation and
close.

Listening backoff is native: Python uses Event.wait, Java interrupts its sleeping
thread, and Go stops its context-owned timer. Rust now unparks its listener and
C++ notifies an owned condition variable. Native HTTP regressions reach EOF,
enter a five-second reconnect wait, then require close to settle within half a
second. C++ verification compiles MCP itself with libcurl for that regression.

Run `npm run test:axir` to exercise all five transport implementations together
with the TypeScript-derived MCP protocol fixtures.
