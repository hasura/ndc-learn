import sqlite3 from 'sqlite3';
import { Database, Statement, open } from 'sqlite';
import { CapabilitiesResponse, CollectionInfo, Connector, ExplainResponse, MutationRequest, MutationResponse, ObjectField, ObjectType, QueryRequest, QueryResponse, RowFieldValue, ScalarType, SchemaResponse, start } from "@hasura/ndc-sdk-typescript";
import { JSONSchemaObject } from "@json-schema-tools/meta-schema";

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

    return state.db.all(`SELECT ${fields.join(", ")} FROM ${request.collection}`);
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