import * as fs from 'fs';
import sqlite3 from 'sqlite3';
import { Database, open } from 'sqlite';
import { BadRequest, CapabilitiesResponse, CollectionInfo, ComparisonTarget, ComparisonValue, Connector, ExplainResponse, Expression, Field, ForeignKeyConstraint, InternalServerError, MutationRequest, MutationResponse, NotSupported, ObjectField, ObjectType, OrderByElement, Query, QueryRequest, QueryResponse, Relationship, RowFieldValue, ScalarType, SchemaResponse, start } from "@hasura/ndc-sdk-typescript";
import { JSONSchemaObject } from "@json-schema-tools/meta-schema";

type RawConfiguration = {
    tables: TableConfiguration[];
};

type Configuration = RawConfiguration;

type TableConfiguration = {
    tableName: string;
    columns: { [k: string]: Column };
    foreignKeys: { [k: string]: ForeignKey };
};

type Column = {};

type ForeignKey = {
    targetTable: string,
    columns: { [k: string]: string };
};

type State = {
    db: Database;
};

function get_raw_configuration_schema(): JSONSchemaObject {
    return JSON.parse(fs.readFileSync("schema.json").toString());
}

function make_empty_configuration(): RawConfiguration {
    throw new Error("Function not implemented.");
}

async function update_configuration(rawConfiguration: RawConfiguration): Promise<RawConfiguration> {
    throw new Error("Function not implemented.");
}

async function validate_raw_configuration(rawConfiguration: RawConfiguration): Promise<Configuration> {
    return rawConfiguration;
}

async function try_init_state(configuration: Configuration, metrics: unknown): Promise<State> {
    const db = await open({
        filename: 'database.db',
        driver: sqlite3.Database
    })

    return { db };
}

async function fetch_metrics(configuration: Configuration, state: State): Promise<undefined> {
    throw new Error("Function not implemented.");
}

async function health_check(configuration: Configuration, state: State): Promise<undefined> {
    throw new Error("Function not implemented.");
}

function get_capabilities(configuration: Configuration): CapabilitiesResponse {
    return {
        versions: "^0.1.0",
        capabilities: {
            query: {},
            explain: {},
            relationships: {}
        }
    }
}

async function get_schema(configuration: Configuration): Promise<SchemaResponse> {
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
        'any': {
            aggregate_functions: {},
            comparison_operators: {}
        }
    };

    let object_types: { [k: string]: ObjectType } = {};

    for (const table of configuration.tables) {
        let fields: { [k: string]: ObjectField } = {};

        for (const columnName in table.columns) {
            fields[columnName] = {
                type: {
                    type: 'named',
                    name: 'any'
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

async function explain(configuration: Configuration, state: State, request: QueryRequest): Promise<ExplainResponse> {
    const sql = fetch_rows_sql(request.collection, request.query, request.collection_relationships, []);
    return {
        details: {
            sql
        }
    };
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

    const where_clause = query.where == null ? additional_predicate ? `WHERE ${additional_predicate}` : '' : `WHERE ${visit_expression(parameters, query.where)} ${additional_predicate ? `AND (${additional_predicate})` : ''}`;

    const order_by_clause = query.order_by == null ? "" : `ORDER BY ${visit_order_by_elements(query.order_by.elements)}`;

    const sql = `SELECT ${fields.join(", ")} FROM ${collection} AS ${table_name} ${where_clause} ${order_by_clause} ${limit_clause} ${offset_clause}`;

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

    const rows = await state.db.all(sql, ...parameters);

    return rows.map((row) => postprocess_fields(query, collection_relationships, row))
}

function fetch_relationship(
    query: Query,
    relationship: Relationship, collection_relationships: {
        [k: string]: Relationship;
    },
    outer_table: string,
    parameters: any[]
): string {
    let json_object_fields: string[] = [];

    for (const field_name in query.fields) {
        json_object_fields.push(`'${field_name}', ${field_name}`);
    }

    const inner_table = peek_table_name();

    const additional_predicates: string[] = [];

    for (const src_column in relationship.column_mapping) {
        const tgt_column = relationship.column_mapping[src_column];
        additional_predicates.push(`${outer_table}.${src_column} = ${inner_table}.${tgt_column}`);
    }

    const subquery = fetch_rows_sql(relationship.target_collection, query, collection_relationships, parameters, additional_predicates.join(" AND "));

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
                    throw new NotSupported("custom aggregates not yet supported");
            }
        }
    }

    const parameters: any[] = [];

    const limit_clause = request.query.limit == null ? "" : `LIMIT ${request.query.limit}`;
    const offset_clause = request.query.offset == null ? "" : `OFFSET ${request.query.offset}`;

    const where_clause = request.query.where == null ? "" : `WHERE ${visit_expression(parameters, request.query.where)}`;

    const order_by_clause = request.query.order_by == null ? "" : `ORDER BY ${visit_order_by_elements(request.query.order_by.elements)}`;

    const sql = `SELECT ${target_list.join(", ")} FROM (
                    SELECT * FROM ${request.collection} ${where_clause} ${order_by_clause} ${limit_clause} ${offset_clause}
                )`;

    console.log(JSON.stringify({ sql, parameters }, null, 2));

    const result = state.db.get(sql, ...parameters);

    if (result === undefined) {
        throw new InternalServerError("Unable to fetch aggregates");
    }

    return result;
}

function visit_expression_with_parens(parameters: any[], expr: Expression): string {
    return `(${visit_expression(parameters, expr)})`;
}

function visit_expression(parameters: any[], expr: Expression): string {
    switch (expr.type) {
        case "and":
            if (expr.expressions.length > 0) {
                return expr.expressions.map(e => visit_expression_with_parens(parameters, e)).join(" AND ");
            } else {
                return "TRUE";
            }
        case "or":
            if (expr.expressions.length > 0) {
                return expr.expressions.map(e => visit_expression_with_parens(parameters, e)).join(" OR ");
            } else {
                return "FALSE";
            }
        case "not":
            return `NOT ${visit_expression_with_parens(parameters, expr.expression)}`;
        case "unary_comparison_operator":
            switch (expr.operator) {
                case 'is_null':
                    return `${visit_comparison_target(expr.column)} IS NULL`;
                default:
                    throw new BadRequest("Unknown comparison operator");
            }
        case "binary_comparison_operator":
            switch (expr.operator.type) {
                case 'equal':
                    return `${visit_comparison_target(expr.column)} = ${visit_comparison_value(parameters, expr.value)}`
                default:
                    throw new BadRequest("Unknown comparison operator");
            }
        case "binary_array_comparison_operator":
            throw new NotSupported("binary_array_comparison_operator is not supported");
        case "exists":
            throw new NotSupported("exists is not supported");
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
        case 'single_column_aggregate':
        case 'star_count_aggregate':
            throw new NotSupported("order_by_aggregate are not supported");
    }
}

const connector: Connector<RawConfiguration, Configuration, State> = {
    get_raw_configuration_schema,
    make_empty_configuration,
    update_configuration,
    validate_raw_configuration,
    try_init_state,
    fetch_metrics,
    health_check,
    get_capabilities,
    get_schema,
    explain,
    mutation,
    query
};

start(connector);