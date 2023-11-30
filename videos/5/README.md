# Let's Build a Connector - Part 5 - Relationships

_TODO_

## Transcript

Hi everyone.

In this video, we're going to start to implement one of the first really interesting and challenging features: relationships. Up to this point, we have been tracking database tables as collections, allowing queries to select from individual tables, but now we will be able to express relationships between those collections, so our database will become a true subgraph of our Hasura supergraph, with both vertices and edges.

Let's start by updating our schema endpoint to include data about potential relationships. This will be useful as documentation, and some thing which has Sarah contract. The test runner will also use this information to generate tests for us.

This will be useful as documentation, and something which Hasura can track in metadata. The test runner will also use this information to generate tests for us.

I'll add the new `foreignKeys` property to the `TableConfiguration` type:

```ts
type TableConfiguration = {
    tableName: string;
    columns: { [k: string]: Column };
    foreignKeys: { [k: string]: ForeignKey };
};

type ForeignKey = {
    targetTable: string,
    columns: { [k: string]: string };
};
```

A `ForeignKey` consists of a target table, and a mapping from foreign key column names to corresponding primary key columns on the target table.

Let's update our `configuration.json` file accordingly:

```json
"foreignKeys": {
    "album_artist": {
        "targetTable": "artists",
        "columns": {
            "artist_id": "id"
        }
    }
}
```

Next, let's add some code to the `get_schema` function which will convert this new configuration into the appropriate part of the schema response:

```ts
let foreign_keys: { [k: string]: ForeignKeyConstraint } = {};

for (const foreignKey in table.foreignKeys) {
    foreign_keys[foreignKey] = {
        foreign_collection: table.foreignKeys[foreignKey].targetTable,
        column_mapping: table.foreignKeys[foreignKey].columns
    }
}
```

Now let's implement the changes to the query endpoint.

First, I'm going to refactor the `fetch_rows` function to extract a new function called `fetch_rows_sql`, which will generate the SQL to run, without actually running it. We can do this in the editor using the language server.

```ts
async function fetch_rows(state: State, request: QueryRequest): Promise<{
    [k: string]: RowFieldValue
}[]> {
    const parameters: any[] = [];

    const sql = fetch_rows_sql(request, parameters);

    console.log(JSON.stringify({ sql, parameters }, null, 2));

    return state.db.all(sql, ...parameters);
}
```

Incidentally, this gives us an easy way to implement the `explain` endpoint:

```ts
async function explain(configuration: Configuration, state: State, request: QueryRequest): Promise<ExplainResponse> {
    const sql = fetch_rows_sql(request, []);
    return {
        details: {
            sql
        }
    };
}
```

Let's also update our capabilities endpoint to reflect our new supported features:

```ts
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
```

Next, let's start to implement the missing `relationship` field type, and see where we run into issues.

Let's start by looking up the relationship definition based on its name. To do this, we'll need to pass the `collection_relationships` map down to our new function:

```ts
const relationship = collection_relationships[field.relationship];
if (relationship === undefined) {
    throw new BadRequest("Undefined relationship");
}
```

Next, let's generate some SQL for the relationship, which will be generated using an auxiliary function which I'll fill in momentarily:

```ts
const rel_sql = fetch_relationship(field.query, relationship, collection_relationships, table_name, parameters);
fields.push(`${expr} AS ${fieldName}`);
break;
```

Before I get into that, let's talk about the `table_name` variable here.

The relationship field is going to be turned into a subquery in the generated SQL. Now, as soon as we have multiple tables in play, we're going to need names to reference them. And we can't just use the name of the table in the database, because we are going to need to be able to refer to the same table multiple times, with possibly different names. For example, if we want to express a self-join using a relationship, we would need two distinct names which would refer to the same database table.

So let's define the `table_name` variable:

```ts
const table_name = new_table_name();
```

This `new_table_name` function will return a brand new table name, which hasn't been used anywhere before, which is important so that we don't run into accidental naming collisions. To implement it, we'll use a simple strategy, which is just a mutable global counter:

```ts
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
```

We'll also call the new `reset_table_name` function at the top of the query function, to make sure our generated SQL is consistent across different runs of the function.

Now let's implement the `fetch_relationship` function, which will generate the SQL for a field of type `relationship`. `fetch_relationship` is going to compute a JSON aggregation over a row set fetched from the related table, so let's fill in the basic form of the SQL:

```ts
function fetch_relationship(
    query: Query,
    relationship: Relationship, 
    collection_relationships: {
        [k: string]: Relationship;
    },
    outer_table: string,
    parameters: any[]
): string {
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
```

We make sqlite do the work of constructing the response JSON in the correct form: an object, with a `rows` property containing a row set. We aggregate all related rows into using a JSON array using the `json_group_array` aggregate function.

The `json_object_fields` array contains a list of field name and value pairs that we want to pass to the `json_object` function, and we'll build that from the `fields` property of the query:

```ts
let json_object_fields: string[] = [];

for (const field_name in query.fields) {
    json_object_fields.push(`'${field_name}', ${field_name}`);
}
```

To build the subquery to fetch the inner row set, we will recursively call our new `fetch_rows_sql` function. 

However, we need to modify the generated SQL in order to add an additional section to the `WHERE` clause in order to express the join condition. We can't do this easily by modifying the query object, because our SQL generation function doesn't handle multiple tables. Instead, we'll add an additional argument to the `fetch_rows_sql` function which holds the SQL for an optional, additional predicate:

```ts
const where_clause = query.where == null 
    ? additional_predicate 
        ? `WHERE ${additional_predicate}` 
        : ''
    : `WHERE ${visit_expression(parameters, query.where)} ${additional_predicate ? `AND (${additional_predicate})` : ''}`;
```

Now let's build our additional predicate from the `column_mapping` property of the relationship, and generate the subquery SQL that we need:

```ts
const inner_table = peek_table_name();

const additional_predicates: string[] = [];

for (const src_column in relationship.column_mapping) {
    const tgt_column = relationship.column_mapping[src_column];
    additional_predicates.push(`${outer_table}.${src_column} = ${inner_table}.${tgt_column}`);
}

const subquery = fetch_rows_sql(state, relationship.target_collection, query, collection_relationships, parameters, additional_predicates.join(" AND "));
```

There is one final change that we need. If we run our connector and test our query endpoint with a relationship, we will see that the returned data contains the correct rows, but encoded incorrectly as strings instead of JSON objects and arrays. This is because the representation of JSON in sqlite is actually as strings, and so that's what we see when we run the query.

Because of this, we need to postprocess the rows that we get back, to unpack any string fields which ought to be returned as JSON. We'll do this using another auxilary function called `postprocess_fields`, which I'll present here in full:

```ts
function postprocess_fields(
    query: Query, 
    collection_relationships: { 
        [k: string]: Relationship
    }, 
    row: any
): any {
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
```

This function works by considering the type of each requested field in turn, and performing the appropriate postprocessing for object and array relationships.

With that, we can update our `fetch_rows` function to postprocess each row in turn:

```ts
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

    const sql = fetch_rows_sql(state, collection, query, collection_relationships, parameters, additional_predicate);

    console.log(JSON.stringify({ sql, parameters }, null, 2));

    const rows = await state.db.all(sql, ...parameters);

    return rows.map((row) => postprocess_fields(query, collection_relationships, row))
}
```

If we run `ndc-test`, we will see that the newly-enabled capability results in new tests being generated, for both array and object relationships, and that we indeed return the correct rows in the correct format.

`ndc-test` will test queries with single relationships, but we can even create custom tests for more interesting cases, like relationships with predicates, or nested relationships.

We've only covered the basics of relationship queries here, and there is plenty more to cover for full support, but this starts to turn our connector into a full subgraph. In future parts, we'll look at some of the more advanced features of relationships in NDC.