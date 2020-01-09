# express-gql

This is a mix between `fastify-gql` and `graphql-api-koa` for Express. 

## Why

I wanted to use `fastify-gql` but I relied on some Express middleware, so I took the GraphQL caching techniques used in `fastify-gql` and copied them into some `express` middleware.

## Setup

```
yarn add express-gql
```

## Usage

```js
const bodyParser = require("body-parser");
const { createGraphqlMiddleware } = require("express-gql");
const express = require("express");
const schema = require('./schema');

const app = express();

app.post(
  "/graphql",
  bodyParser.json(),
  createGraphqlMiddleware({
    context: ({ req, res }) => ({}),
    formatError: ({ req, error }) => error,
    schema
  })
);
```
