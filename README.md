# oc-catalog-matcher

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/Sn0wo2/oc-catalog-matcher)

> Stop hand-writing OpenCode2 model metadata

---

# Installation

Find your OpenCode2 config at ~/.config/opencode.jsonc

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  // ...
  "plugins": [
    // ...
    "github:Sn0wo2/oc-catalog-matcher"
  ]
}
```

Set `providers.<providerID>.cataID` to a preferred catalog provider ID. If unavailable, fall back to the catalog provider that best matches providerID.

Similarly, set `providers.<providerID>.models.<modelID>.cataID` to a preferred catalog model ID. If unavailable, fall back to the catalog model that best matches modelID.
