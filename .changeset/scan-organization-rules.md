---
"@groundrule/cli": minor
---

`groundrule scan --upload` also tests your organization's own rules that have checks, including drafts, against the repository, so their impact shows on the platform before anyone publishes them. An organization rule replaces a catalog rule with the same ID in the scan. Platforms without this feature, or any error fetching the rules, leave the scan to the catalog.
