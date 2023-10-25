# Let's Build a Connector!

This repository contains a series of video tutorials which walk through the process of creating a data connector in small steps. We will build a connector to sqlite which you can run locally on your machine, either by cloning this repo, or by following along with each video.

It is recommended that you first review the [Hasura NDC Specification](http://hasura.github.io/ndc-spec/) and accompanying reference implementation, at least to gain a basic familiarity with the concepts, but these materials are intended to be complementary.

The dependencies required to follow along here are minimal - you will need Node and `npm` so that you can run the TypeScript compiler. If you'd like to follow along using the same test-driven approach, then you will also need a working `ndc-test` executable on your `PATH`. `ndc-test` can be installed using the Rust toolchain from the [`ndc-spec`](https://github.com/hasura/ndc-spec) repository.

## Video Tutorials

1. [Setup \[9:31\]](videos/1/README.markdown)
1. [Predicates \[6:51\]](videos/2/README.markdown)
1. [Sorting \[4:34\]](videos/3/README.markdown)
1. Aggregates

## Getting Started

```sh
npm i
npm run build
```

Run the connector:

```sh
node dist/index.js serve --configuration configuration.json
```