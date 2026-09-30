# Rust changes in Ax 25

`AxError` is now non-exhaustive. Construct it with `AxError::new`, `runtime`, or `validation` rather than a struct literal. It carries sanitized request information in `request`, an optional native `cause`, and the standard `Error::source()` chain. Native causes remain downcastable and survive clones; causes are omitted from serialized errors.

Set a per-call caching callback on `AxForwardOptions::from(options).with_caching_function(cache)` and pass those options to a forward or streaming call. The callback takes precedence over the program and global caches. It applies only to that forward; a flow also passes it to its nodes. Convenience caching methods remain available.

The deprecated `with_field_processor` is removed. Use `with_field_transform` for local rewriting, or `add_field_processor` for model feedback.
