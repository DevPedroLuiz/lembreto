import type { SqlClient } from './handlers/core.js';

type RequiredColumn = {
  table: string;
  column: string;
  schema?: string;
};

type RequiredRelation = {
  name: string;
  schema?: string;
};

type RequiredIndex = {
  name: string;
  schema?: string;
};

type RequiredConstraint = {
  table: string;
  name: string;
  schema?: string;
  contains?: string[];
};

export type RequiredInfrastructure = {
  columns?: RequiredColumn[];
  relations?: RequiredRelation[];
  indexes?: RequiredIndex[];
  constraints?: RequiredConstraint[];
};

export class InfrastructureMissingError extends Error {
  feature: string;
  missing: string[];

  constructor(feature: string, missing: string[]) {
    super(
      `Infraestrutura de banco incompleta para ${feature}: ${missing.join(', ')}. ` +
      'Rode as migrations versionadas antes de iniciar a aplicacao.',
    );
    this.name = 'InfrastructureMissingError';
    this.feature = feature;
    this.missing = missing;
  }
}

function jsonParameter(sql: SqlClient, value: unknown) {
  return sql.json ? sql.json(value) : JSON.stringify(value);
}

function relationKey(relation: RequiredRelation) {
  return `${relation.schema ?? 'public'}.${relation.name}`;
}

function columnKey(column: RequiredColumn) {
  return `${column.schema ?? 'public'}.${column.table}.${column.column}`;
}

function indexKey(index: RequiredIndex) {
  return `${index.schema ?? 'public'}.${index.name}`;
}

function constraintKey(constraint: RequiredConstraint) {
  return `${constraint.schema ?? 'public'}.${constraint.table}.${constraint.name}`;
}

async function existingRelations(sql: SqlClient, relations: RequiredRelation[]) {
  if (relations.length === 0) return new Set<string>();

  const rows = await sql`
    WITH required AS (
      SELECT *
      FROM jsonb_to_recordset(${jsonParameter(sql, relations.map((relation) => ({
        schema: relation.schema ?? 'public',
        name: relation.name,
      })))}::jsonb) AS r(schema text, name text)
    )
    SELECT DISTINCT r.schema, r.name
    FROM required r
    INNER JOIN pg_catalog.pg_namespace n ON n.nspname = r.schema
    INNER JOIN pg_catalog.pg_class c ON c.relnamespace = n.oid
      AND c.relname = r.name
      AND c.relkind IN ('r', 'p', 'v', 'm')
  `;

  return new Set(rows.map((row) => `${String(row.schema)}.${String(row.name)}`));
}

async function existingColumns(sql: SqlClient, columns: RequiredColumn[]) {
  if (columns.length === 0) return new Set<string>();

  const rows = await sql`
    WITH required AS (
      SELECT *
      FROM jsonb_to_recordset(${jsonParameter(sql, columns.map((column) => ({
        schema: column.schema ?? 'public',
        tableName: column.table,
        columnName: column.column,
      })))}::jsonb) AS r(schema text, "tableName" text, "columnName" text)
    )
    SELECT DISTINCT r.schema, r."tableName", r."columnName"
    FROM required r
    INNER JOIN pg_catalog.pg_namespace n ON n.nspname = r.schema
    INNER JOIN pg_catalog.pg_class c ON c.relnamespace = n.oid
      AND c.relname = r."tableName"
    INNER JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
      AND a.attname = r."columnName"
      AND a.attnum > 0
      AND NOT a.attisdropped
  `;

  return new Set(rows.map((row) => (
    `${String(row.schema)}.${String(row.tableName)}.${String(row.columnName)}`
  )));
}

async function existingIndexes(sql: SqlClient, indexes: RequiredIndex[]) {
  if (indexes.length === 0) return new Set<string>();

  const rows = await sql`
    WITH required AS (
      SELECT *
      FROM jsonb_to_recordset(${jsonParameter(sql, indexes.map((index) => ({
        schema: index.schema ?? 'public',
        name: index.name,
      })))}::jsonb) AS r(schema text, name text)
    )
    SELECT DISTINCT r.schema, r.name
    FROM required r
    INNER JOIN pg_catalog.pg_namespace n ON n.nspname = r.schema
    INNER JOIN pg_catalog.pg_class c ON c.relnamespace = n.oid
      AND c.relname = r.name
      AND c.relkind = 'i'
  `;

  return new Set(rows.map((row) => `${String(row.schema)}.${String(row.name)}`));
}

async function constraintDefinitions(sql: SqlClient, constraints: RequiredConstraint[]) {
  if (constraints.length === 0) return new Map<string, string>();

  const rows = await sql`
    WITH required AS (
      SELECT *
      FROM jsonb_to_recordset(${jsonParameter(sql, constraints.map((constraint) => ({
        schema: constraint.schema ?? 'public',
        tableName: constraint.table,
        name: constraint.name,
      })))}::jsonb) AS r(schema text, "tableName" text, name text)
    )
    SELECT DISTINCT
      r.schema,
      r."tableName",
      r.name,
      pg_catalog.pg_get_constraintdef(con.oid) AS definition
    FROM required r
    INNER JOIN pg_catalog.pg_namespace n ON n.nspname = r.schema
    INNER JOIN pg_catalog.pg_class c ON c.relnamespace = n.oid
      AND c.relname = r."tableName"
    INNER JOIN pg_catalog.pg_constraint con ON con.conrelid = c.oid
      AND con.conname = r.name
  `;

  return new Map(rows.map((row) => [
    `${String(row.schema)}.${String(row.tableName)}.${String(row.name)}`,
    typeof row.definition === 'string' ? row.definition : '',
  ]));
}

export async function assertInfrastructure(
  sql: SqlClient,
  feature: string,
  required: RequiredInfrastructure,
) {
  const missing: string[] = [];
  const relations = required.relations ?? [];
  const columns = required.columns ?? [];
  const indexes = required.indexes ?? [];
  const constraints = required.constraints ?? [];

  const [
    presentRelations,
    presentColumns,
    presentIndexes,
    presentConstraintDefinitions,
  ] = await Promise.all([
    existingRelations(sql, relations),
    existingColumns(sql, columns),
    existingIndexes(sql, indexes),
    constraintDefinitions(sql, constraints),
  ]);

  missing.push(...relations
    .filter((relation) => !presentRelations.has(relationKey(relation)))
    .map((relation) => `relation ${relation.schema ?? 'public'}.${relation.name}`));

  missing.push(...columns
    .filter((column) => !presentColumns.has(columnKey(column)))
    .map((column) => `column ${column.schema ?? 'public'}.${column.table}.${column.column}`));

  missing.push(...indexes
    .filter((index) => !presentIndexes.has(indexKey(index)))
    .map((index) => `index ${index.schema ?? 'public'}.${index.name}`));

  for (const constraint of constraints) {
    const definition = presentConstraintDefinitions.get(constraintKey(constraint));
    if (!definition) {
      missing.push(`constraint ${constraint.schema ?? 'public'}.${constraint.table}.${constraint.name}`);
      continue;
    }

    const normalizedDefinition = definition.toLowerCase();
    const missingTerms = (constraint.contains ?? [])
      .filter((term) => !normalizedDefinition.includes(term.toLowerCase()));
    if (missingTerms.length > 0) {
      missing.push(
        `constraint ${constraint.schema ?? 'public'}.${constraint.table}.${constraint.name} missing ${missingTerms.join('/')}`,
      );
    }
  }

  if (missing.length > 0) {
    throw new InfrastructureMissingError(feature, missing);
  }
}
