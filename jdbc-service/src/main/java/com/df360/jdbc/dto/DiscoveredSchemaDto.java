package com.df360.jdbc.dto;

import java.util.List;

public class DiscoveredSchemaDto {

    private String schemaName;
    private List<DiscoveredTableDto> tables;
    private List<DiscoveredTableDto> views;

    public String getSchemaName() {
        return schemaName;
    }

    public void setSchemaName(String schemaName) {
        this.schemaName = schemaName;
    }

    public List<DiscoveredTableDto> getTables() {
        return tables;
    }

    public void setTables(List<DiscoveredTableDto> tables) {
        this.tables = tables;
    }

    public List<DiscoveredTableDto> getViews() {
        return views;
    }

    public void setViews(List<DiscoveredTableDto> views) {
        this.views = views;
    }
}
