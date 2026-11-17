/**
 * The rows of `messages` that may hold an artifact part, which the partial
 * index `messages_artifacts` lists (`ensureIndexes`). A part's type is stored
 * as the JSON string "artifact", with or without a space after its colon; that
 * word inside a text is escaped (\"artifact\") and never matches.
 */
export const ARTIFACT_ROW = `instr(parts, '"artifact"') > 0`;

/**
 * The artifact ids the conversations reference, which artifact retention
 * keeps (`artifact-retention-worker.ts`). Read through `messages_artifacts`:
 * a scan of every message read the whole table (2 GB of a 10.7 GB journal,
 * 4 to 6 s) at each pass and its retries, evicting the core's page cache.
 */
export const ARTIFACT_REFERENCES = `SELECT json_extract(part.value, '$.id') AS id
  FROM messages INDEXED BY messages_artifacts, json_each(messages.parts) AS part
  WHERE ${ARTIFACT_ROW} AND json_extract(part.value, '$.type') = 'artifact'
  UNION SELECT json_extract(json, '$.id') FROM streaming_parts WHERE json_extract(json, '$.type') = 'artifact'`;
