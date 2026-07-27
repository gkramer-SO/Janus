# Report Model Versioning

`report_model_version` is independent of the Janus package version and follows
semantic versioning:

- Patch: compatible corrections that do not change the accepted shape.
- Minor: additive optional fields, enum values, capabilities, or section kinds.
- Major: removed/renamed fields, changed meanings or units, new required fields,
  or otherwise incompatible validation changes.

The v1 contract uses ISO 8601 timestamps normalized to UTC, numeric seconds,
numeric ratios/percentages, JSON booleans, stable IDs, and explicit `null` only
for genuinely unknown values. Zero is never replaced with `null`. Model fields
must not contain HTML or presentation CSS classes.

Dashboard code must compare the major version before rendering. An unsupported
major version must produce a useful compatibility error. A section kind not
understood by an otherwise compatible UI is presented through the `unknown`
fallback envelope rather than interpreted as another section.

`make schema` generates both
`docs/schema/report-model-v1.schema.json` and
`dashboard/src/generated/report-model.ts` from `Core/report_model.py`.
`make schema-check` is the CI drift check. The generated TypeScript file must
never be edited by hand.
