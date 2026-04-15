package com.df360.jdbc.dto;

import java.util.List;

public class DiscoveredForeignKeyDto {

    private String constraintName;
    private List<String> columns;
    private String referencedSchema;
    private String referencedTable;
    private List<String> referencedColumns;

    public String getConstraintName() {
        return constraintName;
    }

    public void setConstraintName(String constraintName) {
        this.constraintName = constraintName;
    }

    public List<String> getColumns() {
        return columns;
    }

    public void setColumns(List<String> columns) {
        this.columns = columns;
    }

    public String getReferencedSchema() {
        return referencedSchema;
    }

    public void setReferencedSchema(String referencedSchema) {
        this.referencedSchema = referencedSchema;
    }

    public String getReferencedTable() {
        return referencedTable;
    }

    public void setReferencedTable(String referencedTable) {
        this.referencedTable = referencedTable;
    }

    public List<String> getReferencedColumns() {
        return referencedColumns;
    }

    public void setReferencedColumns(List<String> referencedColumns) {
        this.referencedColumns = referencedColumns;
    }
}
