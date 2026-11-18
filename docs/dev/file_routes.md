# File pipeline routes

The step-by-step routes the frontend uses after `POST /upload`. They're mounted
at `/files` (`api/src/routes/files.ts`), and each one is a thin wrapper around a
function in `api/src/dataset`. See [data flow](data_flow.md) for how they fit
together.

All three take a JSON body. `path` is the upload's `tempPath` and `sessionId` is
the upload's session; both are required.

## POST /files/geocode

Geocodes one address column and writes the geocode sidecar (`geoSidecar`).

```json
{ "sessionId": "<uuid>", "path": "<upload tempPath>", "addressField": "address" }
```

`addressField` is a column label or ID from `/address-fields`. If it's omitted,
the column is auto-detected and must be unambiguous.

Returns the saved sidecar (`filename`, `tempPath`, ...) plus:

- `addressField`: the resolved column ID
- `counts`: `input`, `output`, `matched`, `unmatched`, `invalidOrBlank`
- `preview`: the original columns plus geocode columns, first 100 rows

## POST /files/acs

Looks up ACS values for each geocoded row and writes the ACS sidecar
(`acsSidecar`).

```json
{
  "sessionId": "<uuid>",
  "path": "<upload tempPath>",
  "geocodeFile": "<geocode tempPath>",
  "acsColumns": [{ "table_id": "B02001", "column_id": "B02001001" }]
}
```

`geocodeFile` and a nonempty, duplicate-free `acsColumns` are required.

Returns the saved sidecar plus `counts` (`input`, `uniqueGeoids`, `withAcs`) and
a `preview` of the ACS columns (first 100 rows).

## POST /files/enrich

Joins the selected sidecars onto the original upload and saves the result
(`enrichFile`).

```json
{
  "sessionId": "<uuid>",
  "path": "<upload tempPath>",
  "geo": true,
  "acs": true,
  "geocodeFile": "<geocode tempPath>",
  "acsFile": "<acs tempPath>",
  "fields": ["latitude", "longitude"],
  "join": "left"
}
```

- At least one of `geo` or `acs` must be true. Each needs its matching sidecar
  path.
- `fields` limits which geocode columns are added (default: all).
- `join` is `left` (keep every row, default) or `inner` (drop unmatched rows).

Returns the saved file (`filename` is what `/download-file` takes), `counts`
(`input`, `output`), and `added` (the output names of the geocode and ACS
columns).

## Errors

Failures return `{ "error": { "code", "message" } }` with the `FileError`
status, or `500` with code `INTERNAL`. Common codes: `INVALID_PATH`,
`INVALID_OPTIONS`, `INVALID_ACS_COLUMNS`, `GEOID_FIELD_NOT_FOUND`,
`INVALID_SIDECAR`, `NOTHING_SELECTED`, `TABLE_TOO_LARGE`, `DEADLINE_EXCEEDED`,
`CANCELLED`.

Generated with Claude Code
