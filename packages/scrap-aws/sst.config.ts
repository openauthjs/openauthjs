/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "scrap-aws",
      removal: input?.stage === "production" ? "retain" : "remove",
      home: "aws",
      providers: {
        aws: {
          region: "us-east-2",
          profile: process.env.GITHUB_ACTIONS ? undefined : "bc-sandbox",
        },
        random: "4.16.7",
        tls: "5.0.9",
      },
    };
  },
  async run() {
    const table = new sst.aws.Dynamo("AuthTable", {
      fields: {
        PK: "string",
        SK: "string",
      },
      primaryIndex: { hashKey: "PK", rangeKey: "SK" },
      ttl: "expiresAt",
    });

    const auth = new sst.aws.Function("Auth", {
      handler: "./aws/authorizer.handler",
      link: [table],
      url: true,
    });

    const api = new sst.aws.Function("Api", {
      handler: "./aws/api.handler",
      link: [auth],
      url: true,
      environment: {
        OPENAUTH_ISSUER: auth.url.apply((v) => {
          return new URL(v).origin;
        }),
      },
    });

    return {
      api: api.url,
      url: auth.url,
    };
  },
});
