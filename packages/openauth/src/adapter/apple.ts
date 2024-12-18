import { Oauth2Adapter, Oauth2WrappedConfig } from "./oauth2.js"
import { OidcAdapter, OidcWrappedConfig } from "./oidc.js"

export function AppleAdapter(config: Oauth2WrappedConfig) {
  return Oauth2Adapter({
    ...config,
    type: "apple",
    responseMode: "form_post",
    endpoint: {
      authorization: "https://appleid.apple.com/auth/authorize",
      token: "https://appleid.apple.com/auth/token",
    },
  })
}

export function AppleOidcAdapter(config: OidcWrappedConfig) {
  return OidcAdapter({
    ...config,
    type: "apple",
    issuer: "https://appleid.apple.com",
  })
}
