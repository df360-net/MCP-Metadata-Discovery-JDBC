/**
 * Data type mapping — maps database-native types to DCF DTYPE-* PIDs.
 * Matches the mapping in DCF discoveryEngine.ts.
 */

const TYPE_MAP: Record<string, string> = {
  // Integer types
  int: "DTYPE-INTEGER", int2: "DTYPE-INTEGER", int4: "DTYPE-INTEGER", int8: "DTYPE-INTEGER",
  integer: "DTYPE-INTEGER", bigint: "DTYPE-INTEGER", smallint: "DTYPE-INTEGER", tinyint: "DTYPE-INTEGER",
  mediumint: "DTYPE-INTEGER", serial: "DTYPE-INTEGER", bigserial: "DTYPE-INTEGER",
  int64: "DTYPE-INTEGER", long: "DTYPE-INTEGER", short: "DTYPE-INTEGER", byte: "DTYPE-INTEGER",
  byteint: "DTYPE-INTEGER",

  // Numeric/decimal types
  numeric: "DTYPE-NUMERIC", decimal: "DTYPE-NUMERIC", number: "DTYPE-NUMERIC",
  float: "DTYPE-NUMERIC", float4: "DTYPE-NUMERIC", float8: "DTYPE-NUMERIC",
  double: "DTYPE-NUMERIC", real: "DTYPE-NUMERIC", money: "DTYPE-NUMERIC", smallmoney: "DTYPE-NUMERIC",
  float64: "DTYPE-NUMERIC",

  // String types
  varchar: "DTYPE-VARCHAR", nvarchar: "DTYPE-VARCHAR", varchar2: "DTYPE-VARCHAR",
  character: "DTYPE-VARCHAR", "character varying": "DTYPE-VARCHAR",
  string: "DTYPE-VARCHAR", text: "DTYPE-TEXT", ntext: "DTYPE-TEXT",
  clob: "DTYPE-TEXT", nclob: "DTYPE-TEXT", longtext: "DTYPE-TEXT", mediumtext: "DTYPE-TEXT",
  char: "DTYPE-CHAR", nchar: "DTYPE-CHAR", bpchar: "DTYPE-CHAR",

  // Boolean
  boolean: "DTYPE-BOOLEAN", bool: "DTYPE-BOOLEAN", bit: "DTYPE-BOOLEAN",

  // Date/time types
  date: "DTYPE-DATE",
  datetime: "DTYPE-TIMESTAMP", datetime2: "DTYPE-TIMESTAMP", datetimeoffset: "DTYPE-TIMESTAMP",
  timestamp: "DTYPE-TIMESTAMP", "timestamp without time zone": "DTYPE-TIMESTAMP",
  "timestamp with time zone": "DTYPE-TIMESTAMP", timestamptz: "DTYPE-TIMESTAMP",
  "timestamp_ntz": "DTYPE-TIMESTAMP", "timestamp_ltz": "DTYPE-TIMESTAMP", "timestamp_tz": "DTYPE-TIMESTAMP",
  time: "DTYPE-TIMESTAMP", smalldatetime: "DTYPE-TIMESTAMP",

  // Binary
  binary: "DTYPE-BINARY", varbinary: "DTYPE-BINARY", blob: "DTYPE-BINARY",
  bytea: "DTYPE-BINARY", image: "DTYPE-BINARY", raw: "DTYPE-BINARY",
  "long raw": "DTYPE-BINARY", bytes: "DTYPE-BINARY",

  // JSON/XML/Structured
  json: "DTYPE-VARCHAR", jsonb: "DTYPE-VARCHAR", xml: "DTYPE-VARCHAR",
  variant: "DTYPE-VARCHAR", object: "DTYPE-VARCHAR", array: "DTYPE-VARCHAR",
  struct: "DTYPE-VARCHAR", map: "DTYPE-VARCHAR", geography: "DTYPE-VARCHAR",
  geometry: "DTYPE-VARCHAR",

  // UUID
  uuid: "DTYPE-VARCHAR", uniqueidentifier: "DTYPE-VARCHAR",
};

/**
 * Map a database-native data type to a DCF DTYPE-* PID.
 * Falls back to DTYPE-VARCHAR for unknown types.
 *
 * Normalization:
 *  - lowercase
 *  - strip parenthesized precision/length/scale, e.g. "varchar(45)" -> "varchar"
 *  - strip MySQL modifiers: "unsigned", "signed", "zerofill"
 *    e.g. "smallint unsigned" -> "smallint"
 *  - strip MSSQL modifiers: "identity"
 *    e.g. "tinyint identity" -> "tinyint"
 *  - collapse whitespace
 */
export function mapDataType(nativeType: string): string {
  const normalized = nativeType
    .toLowerCase()
    .replace(/\(.*\)/, "")                              // strip (n) or (n,m)
    .replace(/\b(unsigned|signed|zerofill|identity)\b/g, "")  // strip DB-specific modifiers
    .replace(/\s+/g, " ")                               // collapse whitespace
    .trim();
  return TYPE_MAP[normalized] ?? "DTYPE-VARCHAR";
}
