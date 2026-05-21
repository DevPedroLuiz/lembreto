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

async function relationExists(sql: SqlClient, relation: RequiredRelation) {
  const rows = await sql`
    SELECT 1
    FROM pg_catalog.pg_class c
    INNER JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = ${relation.schema ?? 'public'}
      AND c.relname = ${relation.name}
      AND c.relkind IN ('r', 'p', 'v', 'm')
    LIMIT 1
  `;

  return rows.length > 0;
}

async function columnExists(sql: SqlClient, column: RequiredColumn) {
  const rows = await sql`
    SELECT 1
    FROM pg_catalog.pg_attribute a
    INNER JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
    INNER JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = ${column.schema ?? 'public'}
      AND c.relname = ${column.table}
      AND a.attname = ${column.column}
      AND a.attnum > 0
      AND NOT a.attisdropped
    LIMIT 1
  `;

  return rows.length > 0;
}

async function indexExists(sql: SqlClient, index: RequiredIndex) {
  const rows = await sql`
    SELECT 1
    FROM pg_catalog.pg_class c
    INNER JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = ${index.schema ?? 'public'}
      AND c.relname = ${index.name}
      AND c.relkind = 'i'
    LIMIT 1
  `;

  return rows.length > 0;
}

async function constraintDefinition(sql: SqlClient, constraint: RequiredConstraint) {
  const rows = await sql`
    SELECT pg_catalog.pg_get_constraintdef(con.oid) AS definition
    FROM pg_catalog.pg_constraint con
    INNER JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
    INNER JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = ${constraint.schema ?? 'public'}
      AND c.relname = ${constraint.table}
      AND con.conname = ${constraint.name}
    LIMIT 1
  `;

  const definition = rows[0]?.definition;
  return typeof definition === 'string' ? definition : null;
}

export async function assertInfrastructure(
  sql: SqlClient,
  feature: string,
  required: RequiredInfrastructure,
) {
  const missing: string[] = [];

  for (const relation of required.relations ?? []) {
    if (!(await relationExists(sql, relation))) {
      missing.push(`relation ${relation.schema ?? 'public'}.${relation.name}`);
    }
  }

  for (const column of required.columns ?? []) {
    if (!(await columnExists(sql, column))) {
      missing.push(`column ${column.schema ?? 'public'}.${column.table}.${column.column}`);
    }
  }

  for (const index of required.indexes ?? []) {
    if (!(await indexExists(sql, index))) {
      missing.push(`index ${index.schema ?? 'public'}.${index.name}`);
    }
  }

  for (const constraint of required.constraints ?? []) {
    const definition = await constraintDefinition(sql, constraint);
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
