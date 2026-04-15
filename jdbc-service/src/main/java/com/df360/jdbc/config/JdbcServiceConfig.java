package com.df360.jdbc.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;

@Configuration
@ConfigurationProperties(prefix = "jdbc-service")
public class JdbcServiceConfig {

    private int connectionTimeoutMs = 10000;
    private int queryTimeoutSeconds = 300;
    private int maxSchemas = 100;
    private int maxTablesPerSchema = 5000;
    private int maxColumnsPerTable = 10000;

    public int getConnectionTimeoutMs() {
        return connectionTimeoutMs;
    }

    public void setConnectionTimeoutMs(int connectionTimeoutMs) {
        this.connectionTimeoutMs = connectionTimeoutMs;
    }

    public int getQueryTimeoutSeconds() {
        return queryTimeoutSeconds;
    }

    public void setQueryTimeoutSeconds(int queryTimeoutSeconds) {
        this.queryTimeoutSeconds = queryTimeoutSeconds;
    }

    public int getMaxSchemas() {
        return maxSchemas;
    }

    public void setMaxSchemas(int maxSchemas) {
        this.maxSchemas = maxSchemas;
    }

    public int getMaxTablesPerSchema() {
        return maxTablesPerSchema;
    }

    public void setMaxTablesPerSchema(int maxTablesPerSchema) {
        this.maxTablesPerSchema = maxTablesPerSchema;
    }

    public int getMaxColumnsPerTable() {
        return maxColumnsPerTable;
    }

    public void setMaxColumnsPerTable(int maxColumnsPerTable) {
        this.maxColumnsPerTable = maxColumnsPerTable;
    }
}
