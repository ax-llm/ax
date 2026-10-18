# core.axir Reference Notes

Core IR is compiler-owned and intentionally not extracted from TypeScript. It
provides the LLVM-like substrate for lowering Ax dialect declarations.

`intrinsic.string.utf8_length(text)` returns UTF-8 byte length, counting each
unpaired surrogate as a three-byte replacement character. Backends implement
this primitive natively so image-size validation does not allocate a list of
code units for a multi-megabyte request. Image format, base64, reference and
request limits remain shared Core behavior in `typesafe.axir`.
