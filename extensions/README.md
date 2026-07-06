# Extensions

Phase 3 adds the `ambassador-discount` Discount Function extension here
(JavaScript/Wasm via Shopify CLI, API 2025-04+), targeting both
`cart.lines.discounts.generate.run` and
`cart.delivery-options.discounts.generate.run`.

One function serves ALL ambassador codes — rules are read from a shop
metafield (namespace `$app:ambassador`, key = normalized code); the function
runs on Shopify's infrastructure and never calls our API.
