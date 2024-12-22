import { Oauth2Adapter, Oauth2WrappedConfig } from "./oauth2.js"

/**
 * Represents the possible OAuth scopes for the Slack adapter.
 *
 * @typedef {("openid" | "email" | "profile")} Scopes
 *
 * @property {"openid"} openid - Grants permission to use OpenID Connect to verify the user's identity.
 * @property {"email"} email - Grants permission to access the user's email address.
 * @property {"profile"} profile - Grants permission to access the user's profile information.
 *
 * @see {@link https://api.slack.com/authentication/sign-in-with-slack}
 */
type Scope = "openid" | "email" | "profile"

/**
 * @interface SlackConfig
 * @extends Oauth2WrappedConfig
 *
 * @property {string} team - The workspace the user is intending to authenticate. If that workspace
 * has been previously authenticated, the user will be signed in directly, bypassing the consent screen.
 * @property {Scopes[]} scopes - The scopes to request from the user.
 *
 * @see {@link https://api.slack.com/authentication/sign-in-with-slack}
 */
export interface SlackConfig extends Oauth2WrappedConfig {
  team: string
  // NOTE: We overrode the scopes to be constrained to the Slack scopes. Scopes will be
  // redundant with different providers, we may want to create a larger union type
  // and use `Extract` or `Exclude` to constrain the scopes.
  scopes: Scope[]
}

/**
 * Creates an OAuth2 adapter for Slack authentication.
 *
 * This function configures an OAuth2 adapter specifically for Slack by
 * providing the necessary authorization and token endpoints.
 *
 * @see {@link https://api.slack.com/authentication/sign-in-with-slack}
 */
export function SlackAdapter(config: SlackConfig) {
  return Oauth2Adapter({
    ...config,
    type: "slack",
    endpoint: {
      authorization: "https://slack.com/openid/connect/authorize",
      token: "https://slack.com/api/openid.connect.token",
    },
  })
}
