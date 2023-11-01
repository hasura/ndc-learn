# Let's Build a Connector!

This repository contains a series of video tutorials which walk through the process of creating a data connector in small steps. We will build a connector to sqlite which you can run locally on your machine, either by cloning this repo, or by following along with each video.

It is recommended that you first review the [Hasura NDC Specification](http://hasura.github.io/ndc-spec/) and accompanying reference implementation, at least to gain a basic familiarity with the concepts, but these materials are intended to be complementary.

The dependencies required to follow along here are minimal - you will need Node and `npm` so that you can run the TypeScript compiler. If you'd like to follow along using the same test-driven approach, then you will also need a working `ndc-test` executable on your `PATH`. `ndc-test` can be installed using the Rust toolchain from the [`ndc-spec`](https://github.com/hasura/ndc-spec) repository.

_Note_: if you would like to follow along with the demos, and deploy this connector to Hasura DDN, you will need to fill out the [DDN Access Form](https://forms.gle/zHTrVEbsQoBK8ecr5)  in order to request access to the DDN limited alpha.

## Video Tutorials

_Note_: in case your browser does not support the GitHub embedded videos in the following links, video files are provided in the same directories, for viewing locally.

1. [Setup \[9:31\]](videos/1/README.markdown)
1. [Predicates \[6:51\]](videos/2/README.markdown)
1. [Sorting \[4:34\]](videos/3/README.markdown)
1. Aggregates

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
node dist/index.js serve --configuration configuration.json
```
