package com.df360.jdbc.service;

import com.df360.jdbc.config.JdbcServiceConfig;
import com.df360.jdbc.dto.*;
import com.df360.jdbc.exception.JdbcDiscoveryException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.sql.*;
import java.time.Instant;
import java.util.*;

@Service
public class MetadataDiscoveryService {

    private static final Logger log = LoggerFactory.getLogger(MetadataDiscoveryService.class);

    private final JdbcServiceConfig config;

    // System schemas to exclude per database type
    private static final Map<String, Set<String>> EXCLUDED_SCHEMAS;

    static {
        Map<String, Set<String>> m = new HashMap<>();
        m.put("POSTGRESQL", new HashSet<>(Arrays.asList(
                "pg_catalog", "information_schema", "pg_toast",
                "pg_temp_1", "pg_toast_temp_1")));
        m.put("MYSQL", new HashSet<>(Arrays.asList(
                "information_schema", "mysql", "performance_schema", "sys")));
        m.put("MSSQL", new HashSet<>(Arrays.asList(
                "INFORMATION_SCHEMA", "sys", "guest", "db_owner",
                "db_accessadmin", "db_securityadmin", "db_ddladmin",
                "db_backupoperator", "db_datareader", "db_datawriter",
                "db_denydatareader", "db_denydatawriter")));
        m.put("ORACLE", new HashSet<>(Arrays.asList(
                "SYS", "SYSTEM", "CTXSYS", "DBSNMP", "MDSYS", "OLAPSYS",
                "ORDDATA", "ORDSYS", "OUTLN", "WMSYS", "XDB",
                "APEX_PUBLIC_USER", "FLOWS_FILES", "ANONYMOUS",
                "APEX_040000", "APPQOSSYS", "AUDSYS", "DBSFWUSER",
                "DIP", "GGSYS", "GSMADMIN_INTERNAL", "GSMCATUSER",
                "GSMUSER", "LBACSYS", "OJVMSYS", "REMOTE_SCHEDULER_AGENT",
                "SI_INFORMTN_SCHEMA", "SYSBACKUP", "SYSDG", "SYSKM",
                "SYSRAC", "WMSYS")));
        m.put("SNOWFLAKE", new HashSet<>(Arrays.asList(
                "INFORMATION_SCHEMA")));
        m.put("REDSHIFT", new HashSet<>(Arrays.asList(
                "information_schema", "pg_catalog", "pg_internal")));
        m.put("TERADATA", new HashSet<>(Arrays.asList(
                "DBC", "SYSLIB", "SYSJDBC", "SYSUDTLIB", "SystemFe",
                "All", "Crashdumps", "SYSSPATIAL", "SysAdmin", "SYSBAR",
                "EXTUSER", "dbcmngr", "SQLJ", "TDStats", "tdwm",
                "TD_SERVER_DB", "TD_SYSFNLIB", "TD_SYSXML", "TDPUSER",
                "console")));
        EXCLUDED_SCHEMAS = Collections.unmodifiableMap(m);
    }

    public MetadataDiscoveryService(JdbcServiceConfig config) {
        this.config = config;
    }

    // ────────────────────────────────────────────────────────────────
    // Test Connection
    // ────────────────────────────────────────────────────────────────

    public TestConnectionResponse testConnection(String jdbcUrl, String user, String password,
                                                  Map<String, String> properties, Integer timeoutMs) {
        long start = System.currentTimeMillis();
        Properties props = buildProperties(user, password, properties);
        int timeoutSec = resolveTimeoutSeconds(timeoutMs);

        try (Connection conn = openConnection(jdbcUrl, props, timeoutSec)) {
            DatabaseMetaData meta = conn.getMetaData();
            String version = meta.getDatabaseProductName() + " " + meta.getDatabaseProductVersion();
            long latency = System.currentTimeMillis() - start;
            log.info("Connection test succeeded: version={}, latency={}ms", version, latency);
            return new TestConnectionResponse(true, version, latency, null);
        } catch (Exception e) {
            long latency = System.currentTimeMillis() - start;
            log.error("Connection test failed: {}", e.getMessage(), e);
            // Include the root cause in the response so the UI shows something actionable
            // instead of a generic driver wrapper like "The connection attempt failed."
            Throwable root = e;
            while (root.getCause() != null && root.getCause() != root) {
                root = root.getCause();
            }
            String detail = root == e ? e.getMessage() : e.getMessage() + " — cause: " + root.getClass().getSimpleName() + ": " + root.getMessage();
            return new TestConnectionResponse(false, null, latency, detail);
        }
    }

    // ────────────────────────────────────────────────────────────────
    // Full Discovery
    // ────────────────────────────────────────────────────────────────

    public DiscoveredDatabaseDto discover(String jdbcUrl, String user, String password,
                                           List<String> schemaFilter, String databaseName,
                                           String databaseType, Map<String, String> properties,
                                           Integer timeoutMs) {
        long start = System.currentTimeMillis();
        Properties props = buildProperties(user, password, properties);
        int timeoutSec = resolveTimeoutSeconds(timeoutMs);

        try (Connection conn = openConnection(jdbcUrl, props, timeoutSec)) {
            // Best-effort read-only hint — some drivers (e.g., Databricks OSS JDBC) don't
            // support it and throw SQLFeatureNotSupportedException. Safe to ignore.
            try { conn.setReadOnly(true); } catch (Exception ignored) { }

            DatabaseMetaData meta = conn.getMetaData();
            String version = meta.getDatabaseProductName() + " " + meta.getDatabaseProductVersion();

            List<String> schemas = resolveSchemas(meta, databaseType, schemaFilter, databaseName);
            log.info("Discovered {} schemas to crawl for {}: {}", schemas.size(), databaseName, schemas);

            if (schemas.size() > config.getMaxSchemas()) {
                log.warn("Schema count {} exceeds max {}, truncating", schemas.size(), config.getMaxSchemas());
                schemas = new ArrayList<>(schemas.subList(0, Math.min(schemas.size(), config.getMaxSchemas())));
            }

            List<DiscoveredSchemaDto> discoveredSchemas = new ArrayList<>();
            for (String schemaName : schemas) {
                log.debug("Discovering schema: {}", schemaName);
                DiscoveredSchemaDto schemaDto = discoverSchema(meta, databaseType, databaseName, schemaName);
                discoveredSchemas.add(schemaDto);
            }

            DiscoveredDatabaseDto result = new DiscoveredDatabaseDto();
            result.setDatabaseName(databaseName);
            result.setServerVersion(version);
            result.setDatabaseType(databaseType);
            result.setSchemas(discoveredSchemas);
            result.setDiscoveredAt(Instant.now());
            result.setDurationMs(System.currentTimeMillis() - start);
            return result;
        } catch (JdbcDiscoveryException e) {
            throw e;
        } catch (Exception e) {
            log.error("Discovery failed for {}: {}", databaseName, e.getMessage(), e);
            throw new JdbcDiscoveryException("Discovery failed: " + e.getMessage(), e);
        }
    }

    // ────────────────────────────────────────────────────────────────
    // Schema Resolution
    // ────────────────────────────────────────────────────────────────

    private List<String> resolveSchemas(DatabaseMetaData meta, String databaseType,
                                         List<String> schemaFilter, String databaseName) throws SQLException {
        // If explicit filter provided, use it directly
        if (schemaFilter != null && !schemaFilter.isEmpty()) {
            return new ArrayList<>(schemaFilter);
        }

        // MySQL: the "database" IS the schema
        if ("MYSQL".equals(databaseType)) {
            return new ArrayList<>(Collections.singletonList(databaseName));
        }

        List<String> schemas = new ArrayList<>();
        Set<String> excluded = EXCLUDED_SCHEMAS.getOrDefault(databaseType, Collections.emptySet());

        try (ResultSet rs = meta.getSchemas()) {
            while (rs.next()) {
                String schemaName = rs.getString("TABLE_SCHEM");
                String catalog = null;
                try {
                    catalog = rs.getString("TABLE_CATALOG");
                } catch (SQLException ignored) {
                    // Some drivers don't support TABLE_CATALOG in getSchemas()
                }

                // Scope to correct catalog for databases that use catalogs
                if (catalog != null && databaseName != null && !databaseName.isEmpty()) {
                    if (!databaseName.equalsIgnoreCase(catalog)) {
                        continue;
                    }
                }

                if (schemaName != null && !excluded.contains(schemaName)) {
                    schemas.add(schemaName);
                }
            }
        }

        // Fallback: try getCatalogs() if no schemas found (e.g., Teradata)
        if (schemas.isEmpty()) {
            log.debug("No schemas found via getSchemas(), trying getCatalogs()");
            try (ResultSet rs = meta.getCatalogs()) {
                while (rs.next()) {
                    String catalogName = rs.getString("TABLE_CAT");
                    if (catalogName != null && !excluded.contains(catalogName)) {
                        schemas.add(catalogName);
                    }
                }
            }
        }

        // Last fallback: use databaseName itself
        if (schemas.isEmpty() && databaseName != null) {
            log.debug("No schemas or catalogs found, using databaseName as schema: {}", databaseName);
            schemas.add(databaseName);
        }

        return schemas;
    }

    // ────────────────────────────────────────────────────────────────
    // Per-Schema Discovery
    // ────────────────────────────────────────────────────────────────

    private DiscoveredSchemaDto discoverSchema(DatabaseMetaData meta, String databaseType,
                                                String databaseName, String schemaName) throws SQLException {
        String catalog = resolveCatalog(databaseType, databaseName);
        String schemaPattern = resolveSchemaPattern(databaseType, schemaName);

        List<DiscoveredTableDto> tables = new ArrayList<>();
        List<DiscoveredTableDto> views = new ArrayList<>();

        try (ResultSet rs = meta.getTables(catalog, schemaPattern, "%", new String[]{"TABLE", "VIEW"})) {
            int tableCount = 0;
            while (rs.next()) {
                if (tableCount >= config.getMaxTablesPerSchema()) {
                    log.warn("Table count exceeds max {} for schema {}, stopping", config.getMaxTablesPerSchema(), schemaName);
                    break;
                }

                String tableName = rs.getString("TABLE_NAME");
                String tableType = rs.getString("TABLE_TYPE");
                String remarks = null;
                try {
                    remarks = rs.getString("REMARKS");
                } catch (SQLException ignored) {
                }

                DiscoveredTableDto tableDto = new DiscoveredTableDto();
                tableDto.setTableName(tableName);
                tableDto.setTableType(tableType != null && tableType.contains("VIEW") ? "VIEW" : "TABLE");
                tableDto.setTableComment(remarks != null && !remarks.isEmpty() ? remarks : null);

                // Discover sub-objects
                tableDto.setColumns(discoverColumns(meta, catalog, schemaPattern, tableName));
                tableDto.setPrimaryKey(discoverPrimaryKey(meta, catalog, schemaPattern, tableName));
                tableDto.setForeignKeys(discoverForeignKeys(meta, catalog, schemaPattern, tableName, schemaName));
                tableDto.setIndexes(discoverIndexes(meta, catalog, schemaPattern, tableName));

                // Mark PK columns
                if (tableDto.getPrimaryKey() != null && tableDto.getColumns() != null) {
                    Set<String> pkCols = new HashSet<>(tableDto.getPrimaryKey().getColumns());
                    for (DiscoveredColumnDto col : tableDto.getColumns()) {
                        if (pkCols.contains(col.getColumnName())) {
                            col.setPrimaryKey(true);
                        }
                    }
                }

                if ("VIEW".equals(tableDto.getTableType())) {
                    views.add(tableDto);
                } else {
                    tables.add(tableDto);
                }
                tableCount++;
            }
        }

        log.debug("Schema {}: {} tables, {} views", schemaName, tables.size(), views.size());

        DiscoveredSchemaDto schemaDto = new DiscoveredSchemaDto();
        schemaDto.setSchemaName(schemaName);
        schemaDto.setTables(tables);
        schemaDto.setViews(views);
        return schemaDto;
    }

    // ────────────────────────────────────────────────────────────────
    // Catalog / Schema Parameter Resolution
    // ────────────────────────────────────────────────────────────────

    private String resolveCatalog(String databaseType, String databaseName) {
        switch (databaseType) {
            case "ORACLE":
            case "DREMIO":
            case "TERADATA":
                return null;
            default:
                return databaseName;
        }
    }

    private String resolveSchemaPattern(String databaseType, String schemaName) {
        if ("MYSQL".equals(databaseType)) {
            return null;
        }
        return schemaName;
    }

    // ────────────────────────────────────────────────────────────────
    // Column Discovery
    // ────────────────────────────────────────────────────────────────

    private List<DiscoveredColumnDto> discoverColumns(DatabaseMetaData meta, String catalog,
                                                       String schema, String tableName) throws SQLException {
        List<DiscoveredColumnDto> columns = new ArrayList<>();
        final int maxCols = config.getMaxColumnsPerTable();
        try (ResultSet rs = meta.getColumns(catalog, schema, tableName, "%")) {
            while (rs.next()) {
                if (columns.size() >= maxCols) {
                    log.warn("Column count exceeds max {} for {}.{}, stopping discovery of remaining columns",
                            maxCols, schema, tableName);
                    break;
                }
                DiscoveredColumnDto col = new DiscoveredColumnDto();
                col.setColumnName(rs.getString("COLUMN_NAME"));
                col.setOrdinalPosition(rs.getInt("ORDINAL_POSITION"));

                String typeName = rs.getString("TYPE_NAME");
                int columnSize = rs.getInt("COLUMN_SIZE");
                int decimalDigits = rs.getInt("DECIMAL_DIGITS");
                boolean decimalDigitsNull = rs.wasNull();

                col.setDataType(typeName != null ? typeName.toLowerCase() : "unknown");
                col.setFullDataType(buildFullDataType(typeName, columnSize, decimalDigits, decimalDigitsNull));
                col.setNullable(rs.getInt("NULLABLE") == DatabaseMetaData.columnNullable);

                String columnDefault = rs.getString("COLUMN_DEF");
                col.setColumnDefault(columnDefault);

                // Character length for string types
                if (isStringType(typeName) && columnSize > 0) {
                    col.setCharacterMaxLength(columnSize);
                }
                // Numeric precision/scale
                if (isNumericType(typeName)) {
                    if (columnSize > 0) col.setNumericPrecision(columnSize);
                    if (!decimalDigitsNull) col.setNumericScale(decimalDigits);
                }

                // Column comment
                String remarks = null;
                try {
                    remarks = rs.getString("REMARKS");
                } catch (SQLException ignored) {
                }
                col.setColumnComment(remarks != null && !remarks.isEmpty() ? remarks : null);

                // Auto-increment detection
                boolean autoIncrement = false;
                try {
                    String isAutoInc = rs.getString("IS_AUTOINCREMENT");
                    autoIncrement = "YES".equalsIgnoreCase(isAutoInc);
                } catch (SQLException ignored) {
                }
                col.setAutoIncrement(autoIncrement);

                col.setPrimaryKey(false); // Set later from PK result

                columns.add(col);
            }
        }
        return columns;
    }

    // ────────────────────────────────────────────────────────────────
    // Primary Key Discovery
    // ────────────────────────────────────────────────────────────────

    private DiscoveredPrimaryKeyDto discoverPrimaryKey(DatabaseMetaData meta, String catalog,
                                                        String schema, String tableName) throws SQLException {
        TreeMap<Integer, String> orderedCols = new TreeMap<>();
        String constraintName = null;

        try (ResultSet rs = meta.getPrimaryKeys(catalog, schema, tableName)) {
            while (rs.next()) {
                constraintName = rs.getString("PK_NAME");
                int keySeq = rs.getInt("KEY_SEQ");
                orderedCols.put(keySeq, rs.getString("COLUMN_NAME"));
            }
        } catch (SQLException e) {
            // Some databases/tables don't support getPrimaryKeys (e.g., Dremio, BigQuery)
            log.debug("getPrimaryKeys not supported for {}.{}: {}", schema, tableName, e.getMessage());
            return null;
        }

        if (orderedCols.isEmpty()) return null;

        DiscoveredPrimaryKeyDto pk = new DiscoveredPrimaryKeyDto();
        pk.setConstraintName(constraintName != null ? constraintName : "PK_" + tableName);
        pk.setColumns(new ArrayList<>(orderedCols.values()));
        return pk;
    }

    // ────────────────────────────────────────────────────────────────
    // Foreign Key Discovery
    // ────────────────────────────────────────────────────────────────

    private List<DiscoveredForeignKeyDto> discoverForeignKeys(DatabaseMetaData meta, String catalog,
                                                               String schema, String tableName,
                                                               String fallbackSchema) throws SQLException {
        Map<String, DiscoveredForeignKeyDto> fkMap = new LinkedHashMap<>();

        try (ResultSet rs = meta.getImportedKeys(catalog, schema, tableName)) {
            while (rs.next()) {
                String fkName = rs.getString("FK_NAME");
                if (fkName == null) {
                    fkName = "FK_" + tableName + "_" + rs.getString("PKTABLE_NAME");
                }

                // Resolve referenced schema:
                //   1. PKTABLE_SCHEM (most databases)
                //   2. PKTABLE_CAT (MySQL — schemas live in catalogs)
                //   3. fallbackSchema (current schema of source table)
                String referencedSchema = null;
                try {
                    referencedSchema = rs.getString("PKTABLE_SCHEM");
                } catch (SQLException ignored) {
                }
                if (referencedSchema == null || referencedSchema.isEmpty()) {
                    try {
                        referencedSchema = rs.getString("PKTABLE_CAT");
                    } catch (SQLException ignored) {
                    }
                }
                if (referencedSchema == null || referencedSchema.isEmpty()) {
                    referencedSchema = fallbackSchema;
                }
                final String finalReferencedSchema = referencedSchema;

                final String finalFkName = fkName;
                DiscoveredForeignKeyDto fk = fkMap.computeIfAbsent(fkName, k -> {
                    DiscoveredForeignKeyDto dto = new DiscoveredForeignKeyDto();
                    dto.setConstraintName(finalFkName);
                    dto.setColumns(new ArrayList<>());
                    dto.setReferencedSchema(finalReferencedSchema);
                    try {
                        dto.setReferencedTable(rs.getString("PKTABLE_NAME"));
                    } catch (SQLException ignored) {
                    }
                    dto.setReferencedColumns(new ArrayList<>());
                    return dto;
                });

                fk.getColumns().add(rs.getString("FKCOLUMN_NAME"));
                fk.getReferencedColumns().add(rs.getString("PKCOLUMN_NAME"));
            }
        } catch (SQLException e) {
            // Some databases don't support getImportedKeys (e.g., Dremio, BigQuery)
            log.debug("getImportedKeys not supported for {}.{}: {}", schema, tableName, e.getMessage());
        }

        return new ArrayList<>(fkMap.values());
    }

    // ────────────────────────────────────────────────────────────────
    // Index Discovery
    // ────────────────────────────────────────────────────────────────

    private List<DiscoveredIndexDto> discoverIndexes(DatabaseMetaData meta, String catalog,
                                                      String schema, String tableName) throws SQLException {
        Map<String, DiscoveredIndexDto> indexMap = new LinkedHashMap<>();

        try (ResultSet rs = meta.getIndexInfo(catalog, schema, tableName, false, false)) {
            while (rs.next()) {
                String indexName = rs.getString("INDEX_NAME");
                if (indexName == null) continue;

                short type = rs.getShort("TYPE");
                if (type == DatabaseMetaData.tableIndexStatistic) continue;

                DiscoveredIndexDto idx = indexMap.computeIfAbsent(indexName, k -> {
                    DiscoveredIndexDto dto = new DiscoveredIndexDto();
                    dto.setIndexName(k);
                    dto.setColumns(new ArrayList<>());
                    try {
                        dto.setUnique(!rs.getBoolean("NON_UNIQUE"));
                    } catch (SQLException ignored) {
                    }
                    return dto;
                });

                String columnName = rs.getString("COLUMN_NAME");
                if (columnName != null) {
                    idx.getColumns().add(columnName);
                }
            }
        } catch (SQLException e) {
            // Some databases don't support getIndexInfo (e.g., Dremio, BigQuery)
            log.debug("getIndexInfo not supported for {}.{}: {}", schema, tableName, e.getMessage());
        }

        return new ArrayList<>(indexMap.values());
    }

    // ────────────────────────────────────────────────────────────────
    // Helpers
    // ────────────────────────────────────────────────────────────────

    /**
     * Open a JDBC connection with a login timeout.
     *
     * NOTE: {@link DriverManager#setLoginTimeout(int)} is JVM-global state. Concurrent
     * callers with different timeouts would race and clobber each other's values.
     * Serializing the (setLoginTimeout + getConnection) pair on DriverManager.class
     * guarantees each caller sees its intended timeout for its own getConnection call.
     * The critical section is short — just the connection handshake setup — so the
     * serialization overhead is negligible for metadata discovery (infrequent, slow).
     */
    private Connection openConnection(String jdbcUrl, Properties props, int timeoutSec) throws SQLException {
        synchronized (DriverManager.class) {
            DriverManager.setLoginTimeout(timeoutSec);
            return DriverManager.getConnection(jdbcUrl, props);
        }
    }

    private Properties buildProperties(String user, String password, Map<String, String> extra) {
        Properties props = new Properties();
        if (user != null && !user.isEmpty()) props.setProperty("user", user);
        if (password != null && !password.isEmpty()) props.setProperty("password", password);
        if (extra != null) props.putAll(extra);
        return props;
    }

    private int resolveTimeoutSeconds(Integer timeoutMs) {
        if (timeoutMs != null && timeoutMs > 0) {
            return Math.max(1, timeoutMs / 1000);
        }
        return Math.max(1, config.getConnectionTimeoutMs() / 1000);
    }

    private String buildFullDataType(String typeName, int columnSize, int decimalDigits, boolean decDigitsNull) {
        if (typeName == null) return "unknown";
        String lower = typeName.toLowerCase();

        if (isStringType(typeName) && columnSize > 0) {
            return lower + "(" + columnSize + ")";
        }
        if (isNumericType(typeName) && columnSize > 0) {
            if (!decDigitsNull && decimalDigits > 0) {
                return lower + "(" + columnSize + "," + decimalDigits + ")";
            }
            return lower + "(" + columnSize + ")";
        }
        return lower;
    }

    private boolean isStringType(String typeName) {
        if (typeName == null) return false;
        String upper = typeName.toUpperCase();
        return upper.contains("CHAR") || upper.contains("TEXT") || upper.contains("CLOB")
                || upper.contains("STRING") || upper.contains("NTEXT");
    }

    private boolean isNumericType(String typeName) {
        if (typeName == null) return false;
        String upper = typeName.toUpperCase();
        return upper.contains("NUMERIC") || upper.contains("DECIMAL") || upper.contains("NUMBER");
    }
}
