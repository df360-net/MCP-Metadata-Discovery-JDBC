package com.df360.jdbc.service;

import java.util.Map;

/**
 * Builds JDBC URLs from database type and connection parameters.
 * This is primarily used for standalone testing of the Java service.
 * In production, the Node.js side builds the JDBC URL and passes it directly.
 */
public class JdbcUrlBuilder {

    private JdbcUrlBuilder() {
    }

    public static String buildUrl(String databaseType, String host, int port, String database,
                                   Map<String, String> extraParams) {
        if (extraParams == null) {
            extraParams = Map.of();
        }

        switch (databaseType) {
            case "POSTGRESQL":
                return "jdbc:postgresql://" + host + ":" + port + "/" + database;

            case "MYSQL":
                return "jdbc:mysql://" + host + ":" + port + "/" + database;

            case "MSSQL":
                return "jdbc:sqlserver://" + host + ":" + port
                       + ";databaseName=" + database
                       + ";encrypt=" + extraParams.getOrDefault("encrypt", "false")
                       + ";trustServerCertificate=" + extraParams.getOrDefault("trustServerCertificate", "true");

            case "ORACLE":
                return "jdbc:oracle:thin:@//" + host + ":" + port + "/" + database;

            case "SNOWFLAKE": {
                String account = host.contains(".") ? host : host + ".snowflakecomputing.com";
                return "jdbc:snowflake://" + account + "/?db=" + database
                       + "&warehouse=" + extraParams.getOrDefault("warehouse", "COMPUTE_WH");
            }

            case "BIGQUERY":
                return "jdbc:bigquery://googleapis.com:443"
                       + ";ProjectId=" + host
                       + ";OAuthType=0"
                       + ";OAuthServiceAcctEmail=" + extraParams.getOrDefault("user", "")
                       + ";OAuthPvtKeyPath=" + extraParams.getOrDefault("keyFilePath", "");

            case "REDSHIFT":
                return "jdbc:redshift://" + host + ":" + port + "/" + database;

            case "DATABRICKS":
                return "jdbc:databricks://" + host + ":" + port
                       + ";httpPath=" + extraParams.getOrDefault("httpPath", "sql/protocolv1/o/0/0")
                       + ";AuthMech=3;UID=token;PWD=" + extraParams.getOrDefault("token", "");

            case "DREMIO":
                return "jdbc:dremio:direct=" + host + ":" + port;

            case "TERADATA":
                return "jdbc:teradata://" + host + "/DATABASE=" + database;

            default:
                throw new IllegalArgumentException("Unsupported database type: " + databaseType);
        }
    }
}
