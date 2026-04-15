package com.df360.jdbc.dto;

import java.time.Instant;
import java.util.List;

public class DiscoveredDatabaseDto {

    private String databaseName;
    private String serverVersion;
    private String databaseType;
    private List<DiscoveredSchemaDto> schemas;
    private Instant discoveredAt;
    private long durationMs;

    public String getDatabaseName() {
        return databaseName;
    }

    public void setDatabaseName(String databaseName) {
        this.databaseName = databaseName;
    }

    public String getServerVersion() {
        return serverVersion;
    }

    public void setServerVersion(String serverVersion) {
        this.serverVersion = serverVersion;
    }

    public String getDatabaseType() {
        return databaseType;
    }

    public void setDatabaseType(String databaseType) {
        this.databaseType = databaseType;
    }

    public List<DiscoveredSchemaDto> getSchemas() {
        return schemas;
    }

    public void setSchemas(List<DiscoveredSchemaDto> schemas) {
        this.schemas = schemas;
    }

    public Instant getDiscoveredAt() {
        return discoveredAt;
    }

    public void setDiscoveredAt(Instant discoveredAt) {
        this.discoveredAt = discoveredAt;
    }

    public long getDurationMs() {
        return durationMs;
    }

    public void setDurationMs(long durationMs) {
        this.durationMs = durationMs;
    }
}
