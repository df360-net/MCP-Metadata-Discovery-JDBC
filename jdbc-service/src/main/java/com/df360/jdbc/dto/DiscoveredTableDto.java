package com.df360.jdbc.dto;

import java.util.List;

public class DiscoveredTableDto {

    private String tableName;
    private String tableType;
    private Long estimatedRowCount;
    private String tableComment;
    private List<DiscoveredColumnDto> columns;
    private DiscoveredPrimaryKeyDto primaryKey;
    private List<DiscoveredForeignKeyDto> foreignKeys;
    private List<DiscoveredIndexDto> indexes;

    public String getTableName() {
        return tableName;
    }

    public void setTableName(String tableName) {
        this.tableName = tableName;
    }

    public String getTableType() {
        return tableType;
    }

    public void setTableType(String tableType) {
        this.tableType = tableType;
    }

    public Long getEstimatedRowCount() {
        return estimatedRowCount;
    }

    public void setEstimatedRowCount(Long estimatedRowCount) {
        this.estimatedRowCount = estimatedRowCount;
    }

    public String getTableComment() {
        return tableComment;
    }

    public void setTableComment(String tableComment) {
        this.tableComment = tableComment;
    }

    public List<DiscoveredColumnDto> getColumns() {
        return columns;
    }

    public void setColumns(List<DiscoveredColumnDto> columns) {
        this.columns = columns;
    }

    public DiscoveredPrimaryKeyDto getPrimaryKey() {
        return primaryKey;
    }

    public void setPrimaryKey(DiscoveredPrimaryKeyDto primaryKey) {
        this.primaryKey = primaryKey;
    }

    public List<DiscoveredForeignKeyDto> getForeignKeys() {
        return foreignKeys;
    }

    public void setForeignKeys(List<DiscoveredForeignKeyDto> foreignKeys) {
        this.foreignKeys = foreignKeys;
    }

    public List<DiscoveredIndexDto> getIndexes() {
        return indexes;
    }

    public void setIndexes(List<DiscoveredIndexDto> indexes) {
        this.indexes = indexes;
    }
}
