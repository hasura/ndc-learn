import sqlite3 from 'sqlite3';
import { Database, open } from 'sqlite';
import { BadRequest, CapabilitiesResponse, CollectionInfo, ComparisonValue, Connector, ExplainResponse, MutationRequest, MutationResponse, NotSupported, ObjectField, ObjectType, QueryRequest, QueryResponse, RowFieldValue, ScalarType, SchemaResponse, start } from "@hasura/ndc-sdk-typescript";
import { JSONSchemaObject } from "@json-schema-tools/meta-schema";
import { ComparisonTarget, Expression } from '@hasura/ndc-sdk-typescript/dist/generated/typescript/QueryRequest';

type RawConfiguration = {
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

function get_raw_configuration_schema(): JSONSchemaObject {
    throw new Error("Function not implemented.");
}

function get_configuration_schema(): JSONSchemaObject {
    throw new Error("Function not implemented.");
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
            query: {}
        }
    }
}

async function get_schema(configuration: Configuration): Promise<SchemaResponse> {
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
            comparison_operators: {},
            update_operators: {},
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
    throw new Error("Function not implemented.");
}

async function mutation(configuration: Configuration, state: State, request: MutationRequest): Promise<MutationResponse> {
    throw new Error("Function not implemented.");
}

async function query(configuration: Configuration, state: State, request: QueryRequest): Promise<QueryResponse> {
    console.log(JSON.stringify(request, null, 2));

    const rows = request.query.fields && await fetch_rows(state, request);

    return [{ rows }];
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

    if (request.query.order_by != null) {
        throw new NotSupported("Sorting is not supported");
    }

    const parameters: any[] = [];

    const limit_clause = request.query.limit == null ? "" : `LIMIT ${request.query.limit}`;
    const offset_clause = request.query.offset == null ? "" : `OFFSET ${request.query.offset}`;

    const where_clause = request.query.where == null ? "" : `WHERE ${visit_expression(parameters, request.query.where)}`;

    const sql = `SELECT ${fields.join(", ")} FROM ${request.collection} ${where_clause} ${limit_clause} ${offset_clause}`;

    console.log(JSON.stringify({ sql, parameters }, null, 2));

    return state.db.all(sql, ...parameters);
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

const connector: Connector<RawConfiguration, Configuration, State> = {
    get_raw_configuration_schema,
    get_configuration_schema,
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