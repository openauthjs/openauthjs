<p align="center">
  <a href="https://openauth.js.org">
    <picture>
      <source srcset="https://raw.githubusercontent.com/openauthjs/identity/main/logo-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="https://raw.githubusercontent.com/openauthjs/identity/main/logo-light.svg" media="(prefers-color-scheme: light)">
      <img src="https://raw.githubusercontent.com/openauthjs/identity/main/logo-light.svg" alt="OpenAuth logo">
    </picture>
  </a>
</p>
<p align="center">
  <a href="https://sst.dev/discord"><img alt="Discord" src="https://img.shields.io/discord/983865673656705025?style=flat-square&label=Discord" /></a>
  <a href="https://www.npmjs.com/package/@openauthjs/openauth"><img alt="npm" src="https://img.shields.io/npm/v/%40openauthjs%2Fcore?style=flat-square" /></a>
  <a href="https://github.com/openauthjs/openauth/actions/workflows/release.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/openauthjs/openauth/release.yml?style=flat-square&branch=master" /></a>
</p>

---

[OpenAuth](https://openauth.js.org) is a standards-based auth provider for web apps, mobile apps, single pages apps, APIs, or 3rd party clients.

- **Universal**: You can deploy it as a standalone service or embed it into an existing application. It works with any framework or platform.
- **Self-hosted**: It runs entirely on your infrastructure and can be deployed on Node.js, Bun, AWS Lambda, or Cloudflare Workers.
- **Standards-based**: It implements the OAuth 2.0 spec and is based on web standards. So any OAuth client can use it.
- **Customizable**: It comes with prebuilt themeable UI that you can customize or opt out of.

## Quick Start

If you just want to get started as fast as possible you check jump straight into the [code examples](https://github.com/openauthjs/openauthjs/tree/master/examples) folder and copy paste away. There are also SST components for deploying everything OpenAuth needs.

## Approach

While there are many open source solutions for auth, almost all of them are libraries that are meant to be embedded into a single application. Centralized auth servers typically are delivered as SaaS services - eg Auth0 or Clerk.

OpenAuth instead is a centralized auth server that runs on your own infrastructure and has been designed for ease of self hosting. It can be used to authenticate all of your applications - web apps, mobile apps, internal admin tools, etc.

It adheres mostly to OAuth 2.0 specifications - which means anything that can speak OAuth can use it to receive access and refresh tokens. When a client initiates an authorization flow, OpenAuth will hand off to one of the configured adapters - this can be third party identity providers like Google, GitHub, etc or built in flows like email/password or pin code.

Because it follows these specifications it can even be used to issue credentials for third party applications - allowing you to implement "login with myapp" flows.

OpenAuth very intentionally does not attempt to solve user management. We've found that this is a very difficult problem given the wide range of databases and drivers that are used in the JS ecosystem. Additionally it's quite hard to build data abstractions that work for every use case. Instead, once a user has identified themselves OpenAuth will invoke a callback where you can implement your own user lookup/creation logic. 

While OpenAuth tries to be mostly stateless, it does need to store a minimal amount of data (refresh tokens, password hashes, etc). However this has been reduced to a simple KV store with various implementations for zero overhead systems like Cloudflare KV and DynamoDB. You should never need to directly access any data that is stored in there.

There is also a themeable UI that you can use to get going without implementing any designs yourself. This is built on top of a lower level system so you can copy paste the default UI and tweak it or opt out entirely and implement your own.

Finally, OpenAuth is created by the maintainers of [SST](https://sst.dev) which is a tool to manage all the infrastructure for your app. It contains components for OpenAuth that make deploying it to AWS or Cloudflare as simple as it can get.

## Tutorial

We'll show how to deploy the auth server and then a sample app that uses it.

### Auth server

Start by importing the `authorizer` function from the `@openauthjs/openauth` package.

```ts
import { authorizer } from "@openauthjs/openauth";
```

OpenAuth is built on top of [Hono](https://github.com/honojs/hono) which is a minimal web framework that can run anywhere. The `authorizer` function creates a Hono app with all of the auth server implemented that you can then deploy to AWS Lambda, Cloudflare Workers, or in a container running under Node.js or Bun.

The `authorizer` function requires a few things:

```ts
const app = authorizer({
  providers: { ... },
  storage,
  subjects,
  success: async (ctx, value) => { ... }
})
```

First we need to define some providers that are enabled - these are either third party identity providers like Google, GitHub, etc or built in flows like email/password or pin code. You can also implement your own. Let's try the GitHub provider.

```ts
import { GithubAdapter } from "@openauthjs/openauth/adapter/github";

const app = authorizer({
  providers: {
    github: GithubAdapter({
      clientID: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      scopes: ["user:email"],
    }),
  },
  ...
})
```

Adapters take some configuration - since this is a third party identity provider there is no UI to worry about and all it needs is a client ID, secret and some scopes. Let's add the password provider which is a bit more complicated.

```ts
import { PasswordAdapter } from "@openauthjs/openauth/adapter/password";

const app = authorizer({
  providers: {
    github: ...,
    password: PasswordAdapter(...),
  },
  ...
})
```

The password adapter is quite complicated as username/password involve a lot of flows so there are a lot of callbacks to implement. However you can opt into the default UI which has all of this already implemented for you. The only thing you have to specify is how to send a code for forgot password/email verification. In this case we'll log the code but you would send this over email.

```ts
import { PasswordAdapter } from "@openauthjs/openauth/adapter/password";
import { PasswordUI } from "@openauthjs/openauth/ui/password";

const app = authorizer({
  providers: {
    github: ...,
    password: PasswordAdapter(
      PasswordUI({
        sendCode: async (email, code) => {
          console.log(email, code);
        },
      }),
    ),
  },
  ...
})
```

Next up is the `subjects` field. Subjects are what the access token generated at the end of the auth flow will map to. Under the hood, the access token is a JWT that contains this data. You will likely just have a single subject to start but you can define additional ones for different types of users.

```ts
import { object, string } from "valibot";

const subjects = createSubjects({
  user: object({
    userID: string(),
    // may want to add workspaceID here if doing a multi-tenant app
    workspaceID: string(),
  }),
});
```

Note we are using [valibot](https://github.com/Valibot/valibot) to define the shape of the subject so it can be validated properly. You can use any validation library that is following the [standard-schema specification](https://github.com/standard-schema/standard-schema) - the next version of Zod will support this.

You typically will want to place subjects in its own file as it can be imported by all of your apps. You can pass it to the authorizer in the `subjects` field.

```ts
import { subjects } from "./subjects.js";

const app = authorizer({
  providers: { ... },
  subjects,
  ...
})
```

Next we'll implement the `success` callback which receives the payload when a user successfully completes a provider flow.

```ts
const app = authorizer({
  providers: { ... },
  subjects,
  async success(ctx, value) {
    let userid;
    if (value.provider === "password") {
      console.log(value.email);
      userid = ... // lookup user or create them
    }
    if (value.provider === "github") {
      console.log(value.tokenset.access);
      userid = ... // lookup user or create them
    }
    return ctx.subject("user", {
        userid,
    });
  }
})
```

Note all of this is typesafe - based on the configured providers you will receive different properties in the `value` object. Also the `subject` method will only accept properties. Note - most callbacks in OpenAuth can return a `Response` object. In this case if something goes wrong, you can return a `Response.redirect("...")` sending them to a different place or rendering an error.

Next we have the `storage` field which defines where things like refresh tokens and password hashes are stored. If on AWS we recommend DynamoDB, if on Cloudflare we recommend Cloudflare KV. We also have a MemoryStore used for testing.

```ts
import { MemoryStorage } from "@openauthjs/openauth/storage/memory";

const app = authorizer({
  providers: { ... },
  subjects,
  async success(ctx, value) { ... },
  storage: MemoryStorage(),
})
```

And now we are ready to deploy! Here's how you do that depending on your infrastructure.

```ts
// Bun
export default app

// Cloudflare
export default app

// Lambda
import { handle } from "hono/aws-lambda"
export const handler = handle(app)

// Node.js
import { serve } from '@hono/node-server'
serve(app)
```


You now have a centralized auth server. Test it out by visiting `/.well-known/oauth-authorization-server` - you can see a live example [here](https://auth.terminal.shop/.well-known/oauth-authorization-server).

### Auth client

Since this is a standard OAuth server you can use any libraries for OAuth and it will work. OpenAuth does provide some light tooling for this although even a manual flow is pretty simple. You can create a client like this:

```ts
import { createClient } from "@openauthjs/openauth"

const client = createClient("my-client", {
  issuer: "https://auth.myserver.com" // this is the url for your auth server
})
```

#### SSR Sites
If your frontend has a server component you can use the code flow. Redirect the user here

``` ts
const redirect = await client.authorize(
  <client-id>,
  <redirect-uri>,
  "code",
);
```

You can make up a `client_id` that represents your app. This will initiate the auth flow and user will be redirected to the `redirect_uri` you provided with a query parameter `code` which you can exchange for an access token.

```ts
const tokens = await client.exchange(query.get("code"), redirect_uri) // the redirect_uri is the original redirect_uri you passed in and is used for verification
console.log(tokens.access, tokens.refresh)
```

You likely want to store both the access token and refresh token in an HTTP only cookie so they are sent up with future requests. Then you can use the `client` to verify the tokens.

```ts
const verified = await client.verify(
  subjects,
  cookies.get("access_token")!,
  { refresh: cookies.get("refresh_token") || undefined },
);
console.log(verified.subject.type, verified.subject.properties, verified.refresh, verified.access);
```

Passing in the refresh token is optional but if you do, this function will automatically refresh the access token if it has expired. It will return a new access token and refresh token which you should set back into the cookies.

#### SPA Sites, Mobile apps, etc

In cases where you do not have a server, you can use the `token` flow with `pkce` on the frontend.

```ts
const [verifier, redirect] = await client.pkce(<client_id>, <redirect_uri>);
localStorage.setItem("verifier", verifier);
location.href = redirect;
```

When the auth flow is complete the user's browser will be redirected to the `redirect_uri` with a `code` query parameter. You can then exchange the code for access/refresh tokens.

```ts
const verifier = localStorage.getItem("verifier");
const tokens = await client.exchange(query.get("code"), redirect_uri, verifier);
localStorage.setItem("access_token", tokens.access);
localStorage.setItem("refresh_token", tokens.refresh);
```

Then when you make requests to your API you can include the access token in the `Authorization` header.

```ts
const accessToken = localStorage.getItem("access_token");
fetch("https://auth.example.com/api/user", {
  headers: {
    Authorization: `Bearer ${accessToken}`,
  },
});
```

And then you can verify the access token on the server.

```ts
const verified = await client.verify(subjects, accessToken);
console.log(verified.subject)
```

---

OpenAuth is created by the maintainers of [SST](https://sst.dev).

**Join our community** [Discord](https://sst.dev/discord) | [YouTube](https://www.youtube.com/c/sst-dev) | [X.com](https://x.com/SST_dev)
