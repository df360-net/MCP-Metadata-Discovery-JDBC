package com.df360.jdbc.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

public class DiscoveredIndexDto {

    private String indexName;
    private List<String> columns;

    @JsonProperty("isUnique")
    private boolean isUnique;

    public String getIndexName() {
        return indexName;
    }

    public void setIndexName(String indexName) {
        this.indexName = indexName;
    }

    public List<String> getColumns() {
        return columns;
    }

    public void setColumns(List<String> columns) {
        this.columns = columns;
    }

    public boolean getIsUnique() {
        return isUnique;
    }

    public void setUnique(boolean unique) {
        isUnique = unique;
    }
}
