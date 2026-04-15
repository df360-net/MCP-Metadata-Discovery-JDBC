# NOTICE

MCP Metadata Discovery — JDBC Edition  
Copyright 2026 Jianmin Wei and contributors

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.

---

## Third-Party Dependencies

This project depends on open-source libraries distributed under their own licenses, including but not limited to:

- **Node.js side**: Express (MIT), Zod (MIT), `@modelcontextprotocol/sdk` (MIT), cors (MIT), express-rate-limit (MIT), React (MIT), Tailwind CSS (MIT), Webpack (MIT), TypeScript (Apache-2.0), Jest (MIT).
- **Java side**: Spring Boot (Apache-2.0), Jackson (Apache-2.0), Logback (EPL-1.0 / LGPL-2.1).

Full license texts for all Node.js dependencies can be viewed with `npm ls --long` after `npm install`. Java dependency licenses are declared in the POMs pulled in by Gradle.

---

## JDBC Drivers — Maven Central

The following JDBC drivers are declared in `jdbc-service/build.gradle` and resolved from Maven Central. Each retains its own license:

| Driver | Maven coordinate | License |
|--------|------------------|---------|
| PostgreSQL | `org.postgresql:postgresql` | BSD-2-Clause |
| MySQL | `com.mysql:mysql-connector-j` | GPL-2.0 with FOSS Exception |
| MSSQL | `com.microsoft.sqlserver:mssql-jdbc` | MIT |
| Oracle | `com.oracle.database.jdbc:ojdbc11` | Oracle Free Use Terms and Conditions |
| Snowflake | `net.snowflake:snowflake-jdbc` | Apache-2.0 |
| Redshift | `com.amazon.redshift:redshift-jdbc42` | Apache-2.0 |
| Teradata | `com.teradata.jdbc:terajdbc` | Teradata License Agreement |

> **Note on MySQL's "GPL-2.0 with FOSS Exception":** Oracle's MySQL Connector/J is GPL-licensed. The FOSS Exception permits use in projects licensed under MIT/Apache/BSD, which covers this project. If you redistribute this project with the driver bundled, verify your distribution complies with the FOSS Exception terms.
>
> **Note on Oracle's `ojdbc11`:** Distributed under Oracle's Free Use Terms and Conditions. Review the terms at [oracle.com/downloads/licenses/oracle-free-license.html](https://www.oracle.com/downloads/licenses/oracle-free-license.html) before production use.

---

## JDBC Drivers — Manual Download Required (NOT included)

The following JDBC drivers are **NOT bundled with this project** and are **NOT automatically resolved** by the build. Users must download them manually into `jdbc-service/libs/` to enable discovery against these databases.

These drivers are **proprietary** — each is distributed under its vendor's own license terms, and the user is responsible for accepting those terms before downloading and using the driver.

| Driver | Vendor | Download | License |
|--------|--------|----------|---------|
| BigQuery JDBC (Simba) | Google / Simba | [cloud.google.com/bigquery/docs/reference/odbc-jdbc-drivers](https://cloud.google.com/bigquery/docs/reference/odbc-jdbc-drivers) | Proprietary — Google BigQuery JDBC License |
| Databricks JDBC | Databricks | [databricks.com/spark/jdbc-drivers-download](https://www.databricks.com/spark/jdbc-drivers-download) | Proprietary — Databricks JDBC Driver License |
| Dremio JDBC | Dremio | [dremio.com/drivers](https://www.dremio.com/drivers/) | Proprietary — Dremio JDBC Driver License |

### Responsibilities of the user

1. **Read and accept each vendor's license terms** before downloading the driver.
2. **Place the downloaded JAR** in `jdbc-service/libs/` with a filename matching the pattern in `build.gradle`:
   - `GoogleBigQueryJDBC42*.jar`
   - `DatabricksJDBC42*.jar`
   - `dremio-jdbc-driver*.jar`
3. **Verify redistribution rules** if you fork this project or package your build for internal distribution — the proprietary drivers may not be redistributable.
4. **Respect any usage restrictions** imposed by the vendor license (for example, limits on commercial use, jurisdiction, or version constraints).

If you do not plan to discover BigQuery, Databricks, or Dremio databases, these drivers are not required — the project will build and run without them, and connectors configured for those types will fail at connection time with a clear error.

---

## Trademarks

All trademarks are the property of their respective owners. Use of a database name or vendor name in this project does not imply endorsement by that vendor.
