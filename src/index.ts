import sqlite3 from 'sqlite3';
import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { Database, open } from 'sqlite';
import { BadRequest, CapabilitiesResponse, CollectionInfo, ComparisonTarget, ComparisonValue, Connector, ExplainResponse, Expression, InternalServerError, MutationRequest, MutationResponse, NotSupported, ObjectField, ObjectType, OrderByElement, QueryRequest, QueryResponse, RowFieldValue, ScalarType, SchemaResponse, start } from "@hasura/ndc-sdk-typescript";

type RawConfiguration = {
    filename: string,
    tables: TableConfiguration[];
};

type Configuration = RawConfiguration;

type TableConfiguration = {
    tableName: string;
    columns: { [k: string]: Column };
};

type Column = {};

type State = {
    db: Database;
};

async function parseConfiguration(configurationDir: string): Promise<Configuration> {
    const configuration_file = resolve(configurationDir, 'configuration.json');
    const configuration_data = await readFile(configuration_file);
    const configuration = JSON.parse(configuration_data.toString());
    return {
        filename: resolve(configurationDir, 'database.db'),
        ...configuration
    };
}

async function tryInitState(configuration: Configuration, metrics: unknown): Promise<State> {
    const db = await open({
        filename: configuration.filename,
        driver: sqlite3.Database
    })

    return { db };
}

async function fetchMetrics(configuration: Configuration, state: State): Promise<undefined> {
    throw new Error("Function not implemented.");
}

async function healthCheck(configuration: Configuration, state: State): Promise<undefined> {
    throw new Error("Function not implemented.");
}

function getCapabilities(configuration: Configuration): CapabilitiesResponse {
    return {
        version: "0.1.2",
        capabilities: {
            query: { aggregates: {} },
            mutation: {},
            relationships: {}
        }
    }
}

async function getSchema(configuration: Configuration): Promise<SchemaResponse> {
    let collections: CollectionInfo[] = configuration.tables.map((table) => {
        return {
            arguments: {},
            name: table.tableName,
            deletable: false,
            foreign_keys: {},
            uniqueness_constraints: {},
            type: table.tableName,
        }
    });

    let scalar_types: { [k: string]: ScalarType } = {
        'any': {
            aggregate_functions: {},
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

async function queryExplain(configuration: Configuration, state: State, request: QueryRequest): Promise<ExplainResponse> {
    throw new Error("Function not implemented.");
}

async function mutationExplain(configuration: Configuration, state: State, request: MutationRequest): Promise<ExplainResponse> {
    throw new Error("Function not implemented.");
}

async function mutation(configuration: Configuration, state: State, request: MutationRequest): Promise<MutationResponse> {
    throw new Error("Function not implemented.");
}

async function query(configuration: Configuration, state: State, request: QueryRequest): Promise<QueryResponse> {
    console.log(JSON.stringify(request, null, 2));

    const rows = request.query.fields && await fetch_rows(state, request);
    const aggregates = request.query.aggregates && await fetch_aggregates(state, request);

    return [{ rows, aggregates }];
}

async function fetch_rows(state: State, request: QueryRequest): Promise<{
    [k: string]: RowFieldValue
}[]> {
    const fields = [];

    for (const fieldName in request.query.fields) {
        if (Object.prototype.hasOwnProperty.call(request.query.fields, fieldName)) {
            const field = request.query.fields[fieldName];
            switch (field.type) {
                case 'column':
                    fields.push(`${field.column} AS ${fieldName}`);
                    break;
                case 'relationship':
                    throw new Error("Relationships are not supported");
            }
        }
    }

    const parameters: any[] = [];

    const limit_clause = request.query.limit == null ? "" : `LIMIT ${request.query.limit}`;
    const offset_clause = request.query.offset == null ? "" : `OFFSET ${request.query.offset}`;

    const where_clause = request.query.predicate == null ? "" : `WHERE ${visit_expression(parameters, request.query.predicate)}`;

    const order_by_clause = request.query.order_by == null ? "" : `ORDER BY ${visit_order_by_elements(request.query.order_by.elements)}`;

    const sql = `SELECT ${fields.length ? fields.join(", ") : '1 AS __empty'} FROM ${request.collection} ${where_clause} ${order_by_clause} ${limit_clause} ${offset_clause}`;

    console.log(JSON.stringify({ sql, parameters }, null, 2));

    const rows = await state.db.all(sql, ...parameters);

    return rows.map((row) => { delete row.__empty; return row; });
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

    const where_clause = request.query.predicate == null ? "" : `WHERE ${visit_expression(parameters, request.query.predicate)}`;

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
            switch (expr.operator) {
                case 'eq':
                    return `${visit_comparison_target(expr.column)} = ${visit_comparison_value(parameters, expr.value)}`
                default:
                    throw new BadRequest("Unknown comparison operator");
            }
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