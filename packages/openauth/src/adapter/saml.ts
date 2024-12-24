import { SAML } from "@node-saml/node-saml"
import { Adapter } from "./adapter.js"
import { getRelativeUrl } from "../util.js"
import { Context } from "hono"
import { InvalidSubjectError } from "../error.js"

export interface SamlConfig {
  type?: string
  idpCert: string | string[];
  idpIssuer: string;
  idpSignonUrl: string;
}

export interface SamlClaims {
  nameID: string
  attributes?: Record<string, string[]>,
}

interface AdapterState {
  relayState: string
}

export function SamlAdapter(
  config: SamlConfig,
): Adapter<{ claims: SamlClaims}> {
  return {
    type: config.type || "saml",
    init(routes, ctx) {
      routes.get("/authorize", async (c) => {
        const saml = getSaml(c, config)
        const relayState = crypto.randomUUID()
        await ctx.set<AdapterState>(c, "adapter", 60 * 10, {
          relayState,
        })
        const form = await saml.getAuthorizeFormAsync(relayState)
        return c.html(form);
      })

      routes.post("/callback", async (c) => {
        const saml = getSaml(c, config)
        const adapter = (await ctx.get(c, "adapter")) as AdapterState
        const formData = await c.req.formData();
        
        const relayState = formData.get('RelayState')
        if (!adapter || (adapter.relayState && relayState !== adapter.relayState)) {
          return c.redirect(getRelativeUrl(c, "./authorize"))
        }

        const samlResponse = formData.get('SAMLResponse')
        if(samlResponse) {
          const p = await saml.validatePostResponseAsync({
            SAMLResponse: samlResponse.toString(),
            RelayState: relayState ? relayState.toString() : "",
          })

          if(!p.profile) {
            throw new InvalidSubjectError();
          }

          return ctx.success(c, {
            claims: {
              get nameID() {
                return p.profile?.nameID || ""
              },
              get attributes() {
                const attributes = <Record<string, string[]>> {};
                if(p.profile && p.profile["attributes"]) {
                  for(const attr of Object.entries(p.profile["attributes"])) {
                    const key = attr[0]
                    const val = attr[1]
                    if(typeof val === 'string') {
                      attributes[key] = [val]
                    }
                    if(isNonEmptyArrayOfStrings(val)) {
                      attributes[key] = val
                    }
                  }
                  return attributes;
                }
              }
            },
          })
        }
      })
    },
  }
}

const isNonEmptyArrayOfStrings = (value: unknown): value is string[] => {
  return Array.isArray(value) && value.length > 0 && value.every(item => typeof item === "string");
}

const getSaml = (c: Context, config: SamlConfig) => {
  return new SAML({ 
    idpCert: config.idpCert,
    issuer: config.idpIssuer,
    entryPoint: config.idpSignonUrl,
    audience: getRelativeUrl(c, "./authorize"),
    callbackUrl: getRelativeUrl(c, "."),
   })
}
