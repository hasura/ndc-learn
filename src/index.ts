import opentelemetry from '@opentelemetry/api';
import sqlite3 from 'sqlite3';
import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { Database, open } from 'sqlite';
import { BadRequest, CapabilitiesResponse, CollectionInfo, ComparisonTarget, ComparisonValue, Connector, ExplainResponse, Expression, ForeignKeyConstraint, InternalServerError, MutationRequest, MutationResponse, NotSupported, ObjectField, ObjectType, OrderByElement, Query, QueryRequest, QueryResponse, Relationship, RowFieldValue, ScalarType, SchemaResponse, start } from "@hasura/ndc-sdk-typescript";
import { withActiveSpan } from "@hasura/ndc-sdk-typescript/instrumentation";
import { Counter, Registry } from 'prom-client';

type Configuration = {
    filename: string,
    tables: TableConfiguration[];
};

type TableConfiguration = {
    tableName: string;
    columns: { [k: string]: Column };
    foreignKeys: { [k: string]: ForeignKey };
};

type Column = {
    type: string;
};

type ForeignKey = {
    targetTable: string,
    columns: { [k: string]: string };
};

type State = {
    db: Database;
    metrics: Metrics;
};

type Metrics = {
    query_count: Counter;
}

async function parseConfiguration(configurationDir: string): Promise<Configuration> {
    const configuration_file = resolve(configurationDir, 'configuration.json');
    const configuration_data = await readFile(configuration_file);
    const configuration = JSON.parse(configuration_data.toString());
    return {
        filename: resolve(configurationDir, 'database.db'),
        ...configuration
    };
}

async function tryInitState(configuration: Configuration, registry: Registry): Promise<State> {
    const db = await open({
        filename: configuration.filename,
        driver: sqlite3.Database
    });

    const query_count = new Counter({
        name: 'query_count',
        help: 'Number of queries executed since the connector was started',
        labelNames: ["table"]
    });
    registry.registerMetric(query_count);
    const metrics = { query_count };

    return { db, metrics };
}

async function fetchMetrics(configuration: Configuration, state: State): Promise<undefined> {
}

async function healthCheck(configuration: Configuration, state: State): Promise<undefined> {
    await state.db.all("SELECT 1");
}

function getCapabilities(configuration: Configuration): CapabilitiesResponse {
    return {
        version: "0.1.2",
        capabilities: {
            query: {
                aggregates: {},
                explain: {}
            },
            mutation: {},
            relationships: {}
        }
    }
}

async function getSchema(configuration: Configuration): Promise<SchemaResponse> {
    let collections: CollectionInfo[] = configuration.tables.map((table) => {
        let foreign_keys: { [k: string]: ForeignKeyConstraint } = {};

        for (const foreignKey in table.foreignKeys) {
            foreign_keys[foreignKey] = {
                foreign_collection: table.foreignKeys[foreignKey].targetTable,
                column_mapping: table.foreignKeys[foreignKey].columns
            }
        }

        return {
            arguments: {},
            name: table.tableName,
            deletable: false,
            foreign_keys,
            uniqueness_constraints: {},
            type: table.tableName,
        }
    });

    let scalar_types: { [k: string]: ScalarType } = {
        'string': {
            aggregate_functions: {
                'csv': {
                    result_type: {
                        type: 'named',
                        name: 'string'
                    }
                }
            },
            comparison_operators: {
                'eq': {
                    type: 'equal'
                },
                'like': {
                    type: 'custom',
                    argument_type: {
                        type: 'named',
                        name: 'string'
                    }
                }
            },
        },
        'numeric': {
            aggregate_functions: {
                'total': {
                    result_type: {
                        type: 'named',
                        name: 'numeric'
                    }
                }
            },
            comparison_operators: {
                'eq': {
                    type: 'equal'
                }
            },
        }
    };

    let object_types: { [k: string]: ObjectType } = {};

    for (const table of configuration.tables) {
        let fields: { [k: string]: ObjectField } = {};

        for (const columnName in table.columns) {
            let column = table.columns[columnName];

            fields[columnName] = {
                type: {
                    type: 'named',
                    name: column.type
                }
            };
        }

        object_types[table.tableName] = {
            fields
        };
    }

    return {
        collections,
        functions: [],
        object_types,
        procedures: [],
        scalar_types,
    };
}

async function queryExplain(configuration: Configuration, state: State, request: QueryRequest): Promise<ExplainResponse> {
    const sql = fetch_rows_sql(request.collection, request.query, request.collection_relationships, []);
    return {
        details: {
            sql
        }
    };
}

async function mutationExplain(configuration: Configuration, state: State, request: MutationRequest): Promise<ExplainResponse> {
    throw new Error("Function not implemented.");
}

async function mutation(configuration: Configuration, state: State, request: MutationRequest): Promise<MutationResponse> {
    throw new Error("Function not implemented.");
}

let table_gensym = 0;

function new_table_name(): string {
    return `table_${++table_gensym}`;
}

function peek_table_name(): string {
    return `table_${table_gensym + 1}`;
}

function reset_table_name() {
    table_gensym = 0;
}

async function query(configuration: Configuration, state: State, request: QueryRequest): Promise<QueryResponse> {
    console.log(JSON.stringify(request, null, 2));

    reset_table_name();

    const rows = request.query.fields && await fetch_rows(state, request.collection, request.query, request.collection_relationships);
    const aggregates = request.query.aggregates && await fetch_aggregates(state, request);

    state.metrics.query_count.labels(request.collection).inc();

    return [{ rows, aggregates }];
}

function fetch_rows_sql(
    collection: string,
    query: Query,
    collection_relationships: {
        [k: string]: Relationship;
    },
    parameters: any[],
    additional_predicate?: string
): string {
    const fields = [];

    const table_name = new_table_name();

    for (const fieldName in query.fields) {
        if (Object.prototype.hasOwnProperty.call(query.fields, fieldName)) {
            const field = query.fields[fieldName];
            switch (field.type) {
                case 'column':
                    fields.push(`${field.column} AS ${fieldName}`);
                    break;
                case 'relationship':
                    const relationship = collection_relationships[field.relationship];
                    if (relationship === undefined) {
                        throw new BadRequest("Undefined relationship");
                    }
                    fields.push(`${fetch_relationship(field.query, relationship, collection_relationships, table_name, parameters)} AS ${fieldName}`);
                    break;
            }
        }
    }

    const limit_clause = query.limit == null ? "" : `LIMIT ${query.limit}`;
    const offset_clause = query.offset == null ? "" : `OFFSET ${query.offset}`;

    const where_clause = query.predicate == null ? additional_predicate ? `WHERE ${additional_predicate}` : '' : `WHERE ${visit_expression(parameters, query.predicate, table_name, collection_relationships)} ${additional_predicate ? `AND (${additional_predicate})` : ''}`;

    const order_by_clause = query.order_by == null ? "" : `ORDER BY ${visit_order_by_elements(query.order_by.elements)}`;

    const sql = `SELECT ${fields.length ? fields.join(", ") : '1 AS __empty'} FROM ${collection} AS ${table_name} ${where_clause} ${order_by_clause} ${limit_clause} ${offset_clause}`;

    return sql;
}

function postprocess_fields(query: Query, collection_relationships: { [k: string]: Relationship }, row: any): any {
    let new_row: any = {};

    if (query.fields == null) {
        throw new InternalServerError("postprocess_fields: fields was not defined");
    }

    for (const field_name in query.fields) {
        if (Object.prototype.hasOwnProperty.call(query.fields, field_name)) {
            const field = query.fields[field_name];
            switch (field.type) {
                case 'column':
                    new_row[field_name] = row[field_name];
                    break;
                case 'relationship':
                    const row_data = JSON.parse(row[field_name]);
                    if (row_data.rows && Array.isArray(row_data.rows)) {
                        new_row[field_name] = {
                            rows: row_data.rows.map((row: any) => postprocess_fields(field.query, collection_relationships, row))
                        };
                    } else {
                        throw new InternalServerError("Expected array in relationship response");
                    }
                    break;
            }
        }
    }

    return new_row;
}

async function fetch_rows(
    state: State,
    collection: string,
    query: Query,
    collection_relationships: {
        [k: string]: Relationship;
    },
    additional_predicate?: string
): Promise<{
    [k: string]: RowFieldValue
}[]> {
    const parameters: any[] = [];

    const sql = fetch_rows_sql(collection, query, collection_relationships, parameters, additional_predicate);

    console.log(JSON.stringify({ sql, parameters }, null, 2));

    const spanAttributes = { sql };
    const tracer = opentelemetry.trace.getTracer("ndc-learn");

    return withActiveSpan(tracer, "run SQL", async () => {
        const rows = await state.db.all(sql, ...parameters);
        return rows.map((row) => postprocess_fields(query, collection_relationships, row))
    }, spanAttributes);
}

function fetch_relationship(
    query: Query,
    relationship: Relationship,
    collection_relationships: {
        [k: string]: Relationship;
    },
    outer_table: string,
    parameters: any[]
): string {
    let json_object_fields: string[] = [];

    for (const field_name in query.fields) {
        json_object_fields.push(`'${field_name}', ${field_name}`);
    }

    const subquery = fetch_relationship_rows(query, relationship, collection_relationships, outer_table, parameters);

    return `(SELECT 
                json_object(
                    'rows', 
                    json_group_array(
                        json_object(${json_object_fields.join(", ")})
                    )
                )
             FROM (${subquery})
            )`;
}

function fetch_relationship_rows(
    query: Query,
    relationship: Relationship,
    collection_relationships: {
        [k: string]: Relationship;
    },
    outer_table: string,
    parameters: any[]
): string {
    const inner_table = peek_table_name();

    const additional_predicates: string[] = [];

    for (const src_column in relationship.column_mapping) {
        const tgt_column = relationship.column_mapping[src_column];
        additional_predicates.push(`${outer_table}.${src_column} = ${inner_table}.${tgt_column}`);
    }

    const subquery = fetch_rows_sql(relationship.target_collection, query, collection_relationships, parameters, additional_predicates.join(" AND "));

    return subquery;
}

async function fetch_aggregates(state: State, request: QueryRequest): Promise<{
    [k: string]: unknown
}> {
    const target_list = [];

    for (const aggregateName in request.query.aggregates) {
        if (Object.prototype.hasOwnProperty.call(request.query.aggregates, aggregateName)) {
            const aggregate = request.query.aggregates[aggregateName];
            switch (aggregate.type) {
                case 'star_count':
                    target_list.push(`COUNT(1) AS ${aggregateName}`);
                    break;
                case 'column_count':
                    target_list.push(`COUNT(${aggregate.distinct ? 'DISTINCT ' : ''}${aggregate.column}) AS ${aggregateName}`);
                    break;
                case 'single_column':
                    switch (aggregate.function) {
                        case 'total':
                            target_list.push(`TOTAL(${aggregate.column}) AS ${aggregateName}`);
                            break;
                        case 'csv':
                            target_list.push(`GROUP_CONCAT(${aggregate.column}, ',') AS ${aggregateName}`);
                            break;
                        default:
                            throw new BadRequest("Unknown aggregate function");
                    }
            }
        }
    }

    const parameters: any[] = [];

    const limit_clause = request.query.limit == null ? "" : `LIMIT ${request.query.limit}`;
    const offset_clause = request.query.offset == null ? "" : `OFFSET ${request.query.offset}`;

    const where_clause = request.query.predicate == null ? "" : `WHERE ${visit_expression(parameters, request.query.predicate, request.collection, request.collection_relationships)}`;

    const order_by_clause = request.query.order_by == null ? "" : `ORDER BY ${visit_order_by_elements(request.query.order_by.elements)}`;

    const sql = `SELECT ${target_list.length ? target_list.join(", ") : "1 AS __empty"} FROM (
                    SELECT * FROM ${request.collection} ${where_clause} ${order_by_clause} ${limit_clause} ${offset_clause}
                )`;

    console.log(JSON.stringify({ sql, parameters }, null, 2));

    const result = await state.db.get(sql, ...parameters);

    delete result.__empty;

    if (result === undefined) {
        throw new InternalServerError("Unable to fetch aggregates");
    }

    return result;
}

function visit_expression_with_parens(
    parameters: any[],
    expr: Expression,
    collection: string,
    collection_relationships: {
        [k: string]: Relationship;
    }
): string {
    return `(${visit_expression(parameters, expr, collection, collection_relationships)})`;
}

function visit_expression(
    parameters: any[],
    expr: Expression,
    collection: string,
    collection_relationships: {
        [k: string]: Relationship;
    }
): string {
    switch (expr.type) {
        case "and":
            if (expr.expressions.length > 0) {
                return expr.expressions.map(e => visit_expression_with_parens(parameters, e, collection, collection_relationships)).join(" AND ");
            } else {
                return "TRUE";
            }
        case "or":
            if (expr.expressions.length > 0) {
                return expr.expressions.map(e => visit_expression_with_parens(parameters, e, collection, collection_relationships)).join(" OR ");
            } else {
                return "FALSE";
            }
        case "not":
            return `NOT ${visit_expression_with_parens(parameters, expr.expression, collection, collection_relationships)}`;
        case "unary_comparison_operator":
            switch (expr.operator) {
                case 'is_null':
                    return `${visit_comparison_target(expr.column)} IS NULL`;
                default:
                    throw new BadRequest("Unknown comparison operator");
            }
        case "binary_comparison_operator":
            switch (expr.operator) {
                case 'eq':
                    return `${visit_comparison_target(expr.column)} = ${visit_comparison_value(parameters, expr.value)}`
                case 'like':
                    return `${visit_comparison_target(expr.column)} LIKE ${visit_comparison_value(parameters, expr.value)}`
                default:
                    throw new BadRequest("Unknown comparison operator");
            }
        case "exists":
            switch (expr.in_collection.type) {
                case 'related':
                    const relationship = collection_relationships[expr.in_collection.relationship];
                    if (relationship === undefined) {
                        throw new BadRequest("Undefined relationship");
                    }
                    let subquery = fetch_relationship_rows({
                        fields: {},
                        predicate: expr.predicate,
                    },
                        relationship,
                        collection_relationships,
                        collection,
                        parameters);
                    return `EXISTS (${subquery})`;
                case 'unrelated':
                    throw new NotSupported("exists is not supported");
            }
        default:
            throw new BadRequest("Unknown expression type");
    }
}

function visit_comparison_target(target: ComparisonTarget) {
    switch (target.type) {
        case 'column':
            if (target.path.length > 0) {
                throw new NotSupported("Relationships are not supported");
            }
            return target.name;
        case 'root_collection_column':
            throw new NotSupported("Relationships are not supported");
    }
}

function visit_comparison_value(parameters: any[], target: ComparisonValue) {
    switch (target.type) {
        case 'scalar':
            parameters.push(target.value);
            return "?";
        case 'column':
            throw new NotSupported("column_comparisons are not supported");
        case 'variable':
            throw new NotSupported("Variables are not supported");
    }
}

function visit_order_by_elements(elements: OrderByElement[]): String {
    if (elements.length > 0) {
        return elements.map(visit_order_by_element).join(", ");
    } else {
        return "1";
    }
}

function visit_order_by_element(element: OrderByElement): String {
    const direction = element.order_direction === 'asc' ? 'ASC' : 'DESC';

    switch (element.target.type) {
        case 'column':
            if (element.target.path.length > 0) {
                throw new NotSupported("Relationships are not supported");
            }
            return `${element.target.name} ${direction}`;
        default:
            throw new NotSupported("order_by_aggregate are not supported");
    }
}

const connector: Connector<Configuration, State> = {
    parseConfiguration,
    tryInitState,
    fetchMetrics,
    healthCheck,
    getCapabilities,
    getSchema,
    queryExplain,
    mutationExplain,
    mutation,
    query
};

start(connector);