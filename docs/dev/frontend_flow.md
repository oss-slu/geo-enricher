# Frontend flow

The UI is a single page of four steps. All state and API calls live in one hook,
`useEnrichFlow` (`app/src/hooks/useEnrichFlow.ts`); the step components in
`app/src/cmp/ux` only render and forward events. API calls are in
`app/src/api/files.ts`. See [data flow](data_flow.md) for the backend side.

## Steps

| Component | Hook action | API calls |
| --- | --- | --- |
| `UploadStep` | `chooseFile`, `chooseAddress` | `/upload`, `/address-fields`, then `/files/geocode` |
| `GeocodeStep` | `setAddressField`, `geocodeStep` | `/files/geocode` |
| `AcsStep` | `acsStep` | `/files/acs` (`ColumnSelector` loads `/acs-metadata`) |
| `EnrichStep` | `enrichStep` | `/files/enrich`, `/download-file` |

- **Upload.** The file is previewed locally (`parsePreview`), uploaded, and
  scanned for address columns. If one is found, the first is selected and
  geocoded automatically.
- **Single address.** `chooseAddress` wraps a typed address in a one-row CSV
  with an `address` column and sends it through `chooseFile`, so it follows the
  exact same path as a file.
- **Geocode.** The button re-runs the geocoder, for example after picking a
  different address column or after a failed automatic run.
- **ACS.** Needs a geocode result and at least one selected column.
- **Enrich.** Lets the user include geocode data, ACS data, or both, then
  downloads the result.

## One action at a time

Every action goes through `run(step, fn)`, which sets `busy` to the running
step, clears the last error, and reports failures in `error`. While `busy` is
set, all controls are disabled and further actions are ignored. A ref mirrors
`busy` so two actions started in the same tick can't both run.

## Stale results

Downstream results are cleared whenever something upstream changes:

- A new file or address clears everything.
- Changing the address field clears the geocode, ACS, and enriched results.
- Geocoding again clears ACS and enriched results.
- Fetching ACS again clears the enriched result.

Changing the ACS column selection after a fetch doesn't clear the result; it
marks it stale (`acsStale`). The ACS step shows a warning, and enrich won't
include ACS data until it's fetched again.

Generated with Claude Code
