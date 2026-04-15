/**
 * Ingestion API Types — mirrors DCF Metadata Ingestion REST API contract.
 *
 * These types define the payload shapes for the 3 ingestion endpoints:
 * 1. container-with-entities (database/schema + tables + columns)
 * 2. entity-with-elements (single table into existing container)
 * 3. lineage (column → column edges)
 */

// ---------------------------------------------------------------------------
// Shared response
// ---------------------------------------------------------------------------

export interface IngestionSummary {
  total: number;
  created: number;
  updated: number;
  unchanged: number;
  failed: number;
}

export interface IngestionResultItem {
  pid: string;
  action: "created" | "updated" | "unchanged" | "failed";
  id?: string;
  error?: string;
}

export interface IngestionResponse {
  status: "completed" | "partial" | "failed";
  summary: IngestionSummary;
  results: IngestionResultItem[];
}

// ---------------------------------------------------------------------------
// 1. Container with Entities
// ---------------------------------------------------------------------------

export interface ContainerPayload {
  data_container_pid: string;
  data_container_name: string;
  data_container_description: string;
  container_type_pid: string;
  data_container_server?: string;
  data_container_connection_string?: string;
  is_active: "Y" | "N";
}

export interface EntityPayload {
  data_entity_pid: string;
  data_entity_name: string;
  data_entity_description: string;
  entity_type_pid: string;
  enterprise_dataset_id?: string;
  business_use_case_pid?: string;
  is_active: "Y" | "N";
}

export interface ElementPayload {
  data_element_pid: string;
  data_element_name: string;
  data_element_description: string;
  data_type_pid: string;
  position?: number;
  length?: number;
  precision?: number;
  scale?: number;
  pii_indicator: "Y" | "N";
  enterprise_data_element_id?: string;
  transform_type_pid?: string;
  transform_logic?: string;
  is_active: "Y" | "N";
}

export interface EntityWithElements {
  entity: EntityPayload;
  elements: ElementPayload[];
}

export interface ContainerWithEntitiesPayload {
  application_pid: string;
  container: ContainerPayload;
  entities: EntityWithElements[];
}

// ---------------------------------------------------------------------------
// 2. Entity with Elements
// ---------------------------------------------------------------------------

export interface EntityWithElementsPayload {
  container_pid: string;
  entity: EntityPayload;
  elements: ElementPayload[];
}

// ---------------------------------------------------------------------------
// 3. Lineage
// ---------------------------------------------------------------------------

export type LineageSourceType = "FK" | "OPERATIONAL" | "ETL" | "SQL_PARSER" | "MANUAL";

export interface LineageEdgePayload {
  source_element_pid: string;
  target_element_pid: string;
}

export interface LineagePayload {
  application_pid: string;
  lineage_source: LineageSourceType;
  edges: LineageEdgePayload[];
}
