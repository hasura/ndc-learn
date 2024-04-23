# Let's Build a Connector!

This repository contains a series of tutorials which walk through the process of creating a data connector in small steps. We will build a connector to sqlite which you can run locally on your machine, either by cloning this repo, or by following along with each tutorial.

It is recommended that you first review the [Hasura NDC Specification](http://hasura.github.io/ndc-spec/) and accompanying reference implementation, at least to gain a basic familiarity with the concepts, but these materials are intended to be complementary.

The dependencies required to follow along here are minimal - you will need Node and `npm` so that you can run the TypeScript compiler. If you'd like to follow along using the same test-driven approach, then you will also need a working `ndc-test` executable on your `PATH`. `ndc-test` can be installed using the Rust toolchain from the [`ndc-spec`](https://github.com/hasura/ndc-spec) repository.

## Tutorials

1. [Setup](tutorials/1.setup.markdown)
1. [Predicates](tutorials/2.predicates.markdown)
1. [Sorting](tutorials/3.sorting.markdown)
1. [Aggregates](tutorials/4.aggregates.markdown)
1. [Relationships](tutorials/5.relationships.markdown)
1. [Custom Operators](tutorials/6.operators.markdown)

## Other Resources

- [NDC Specification](https://hasura.github.io/ndc-spec/specification/)
  - [Reference Implementation with Tutorial](https://github.com/hasura/ndc-spec/tree/main/ndc-reference/tests)
- SDKs
  - [NDC Rust SDK](https://github.com/hasura/ndc-hub)
  - [NDC Typescript SDK](https://github.com/hasura/ndc-sdk-typescript) 
- Examples of Native Connectors
  - [Clickhouse](https://github.com/hasura/ndc-clickhouse) (Rust)
  - [QDrant](https://github.com/hasura/ndc-qdrant) (Typescript)
  - [Deno](https://github.com/hasura/ndc-typescript-deno) (Typescript)

## Getting Started

```sh
npm i
npm run build
```

Run the connector:

```sh
node dist/index.js serve --configuration .
```

To start from scratch and create the initial project:

```sh
npm init
npm i typescript
npx tsc --init
npm i @hasura/ndc-sdk-typescript sqlite sqlite3
```

### Running the connector using Docker

The provided `Dockerfile` can be used to build and run the connector inside a Docker container:

```sh
docker build -t ndc-learn .
docker run -p 8080:8080 -it ndc-learn
```

### Local development using v3-engine

The `docker-compose.yaml` file provides an environment with the open source Hasura `v3-engine`, this connector, and Jaeger for tracing:

```sh
docker compose up
open http://localhost:3000 # Graphiql
open http://localhost:4002 # Jaeger
```

When using Graphiql, remember to provide the appropriate headers. Specifically, `x-hasura-role` can be set to `admin` for testing.