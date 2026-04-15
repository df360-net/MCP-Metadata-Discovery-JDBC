package com.df360.jdbc.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

public class DiscoveredColumnDto {

    private String columnName;
    private int ordinalPosition;
    private String dataType;
    private String fullDataType;

    @JsonProperty("isNullable")
    private boolean isNullable;

    private String columnDefault;
    private Integer characterMaxLength;
    private Integer numericPrecision;
    private Integer numericScale;

    @JsonProperty("isPrimaryKey")
    private boolean isPrimaryKey;

    @JsonProperty("isAutoIncrement")
    private boolean isAutoIncrement;

    private String columnComment;

    public String getColumnName() {
        return columnName;
    }

    public void setColumnName(String columnName) {
        this.columnName = columnName;
    }

    public int getOrdinalPosition() {
        return ordinalPosition;
    }

    public void setOrdinalPosition(int ordinalPosition) {
        this.ordinalPosition = ordinalPosition;
    }

    public String getDataType() {
        return dataType;
    }

    public void setDataType(String dataType) {
        this.dataType = dataType;
    }

    public String getFullDataType() {
        return fullDataType;
    }

    public void setFullDataType(String fullDataType) {
        this.fullDataType = fullDataType;
    }

    public boolean getIsNullable() {
        return isNullable;
    }

    public void setNullable(boolean nullable) {
        isNullable = nullable;
    }

    public String getColumnDefault() {
        return columnDefault;
    }

    public void setColumnDefault(String columnDefault) {
        this.columnDefault = columnDefault;
    }

    public Integer getCharacterMaxLength() {
        return characterMaxLength;
    }

    public void setCharacterMaxLength(Integer characterMaxLength) {
        this.characterMaxLength = characterMaxLength;
    }

    public Integer getNumericPrecision() {
        return numericPrecision;
    }

    public void setNumericPrecision(Integer numericPrecision) {
        this.numericPrecision = numericPrecision;
    }

    public Integer getNumericScale() {
        return numericScale;
    }

    public void setNumericScale(Integer numericScale) {
        this.numericScale = numericScale;
    }

    public boolean getIsPrimaryKey() {
        return isPrimaryKey;
    }

    public void setPrimaryKey(boolean primaryKey) {
        isPrimaryKey = primaryKey;
    }

    public boolean getIsAutoIncrement() {
        return isAutoIncrement;
    }

    public void setAutoIncrement(boolean autoIncrement) {
        isAutoIncrement = autoIncrement;
    }

    public String getColumnComment() {
        return columnComment;
    }

    public void setColumnComment(String columnComment) {
        this.columnComment = columnComment;
    }
}
