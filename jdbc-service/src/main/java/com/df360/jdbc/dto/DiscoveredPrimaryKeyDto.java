package com.df360.jdbc.dto;

import java.util.List;

public class DiscoveredPrimaryKeyDto {

    private String constraintName;
    private List<String> columns;

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
}
