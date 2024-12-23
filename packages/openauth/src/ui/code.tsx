/** @jsxImportSource hono/jsx */

import { CodeAdapterOptions } from "../adapter/code.js"
import { UnknownStateError } from "../error.js"
import { Layout } from "./base.js"
import { FormAlert } from "./form.js"

const DEFAULT_COPY = {
  email_placeholder: "Email",
  email_invalid: "Email address is not valid",
  button_continue: "Continue",
  code_info: "We'll send a pin code to your email",
  code_placeholder: "Code",
  code_invalid: "Invalid code",
  code_sent: "Code sent to ",
  code_resent: "Code resent to ",
  code_didnt_get: "Didn't get code?",
  code_resend: "Resend",
}

export type CodeUICopy = typeof DEFAULT_COPY

export type CodeUIInputOptions = Partial<{
  inputType: "email" | "text" | "tel"
  inputName: string
  inputPattern: string
  inputTitle: string
}>

export function CodeUI(props: {
  sendCode: (claims: Record<string, string>, code: string) => Promise<void>
  copy?: Partial<CodeUICopy>
  inputOptions?: CodeUIInputOptions
}) {
  const copy = {
    ...DEFAULT_COPY,
    ...props.copy,
  }

  const { inputName, inputPattern, inputTitle, inputType } =
    props.inputOptions ?? {}

  return {
    sendCode: props.sendCode,
    length: 6,
    request: async (_req, state, _form, error): Promise<Response> => {
      if (state.type === "start") {
        const jsx = (
          <Layout>
            <form data-component="form" method="post">
              {error?.type === "invalid_claim" && (
                <FormAlert message={copy.email_invalid} />
              )}
              <input type="hidden" name="action" value="request" />
              <input
                data-component="input"
                autofocus
                type={inputType ?? "email"}
                name={inputName ?? "email"}
                pattern={inputPattern ?? undefined}
                title={inputTitle ?? undefined}
                inputmode={inputType === "tel" ? "numeric" : "email"}
                required
                placeholder={copy.email_placeholder}
              />
              <button data-component="button">{copy.button_continue}</button>
            </form>
            <p data-component="form-footer">{copy.code_info}</p>
          </Layout>
        )
        return new Response(jsx.toString(), {
          headers: {
            "Content-Type": "text/html",
          },
        })
      }

      if (state.type === "code") {
        const jsx = (
          <Layout>
            <form data-component="form" class="form" method="post">
              {error?.type === "invalid_code" && (
                <FormAlert message={copy.code_invalid} />
              )}
              {state.type === "code" && (
                <FormAlert
                  message={
                    (state.resend ? copy.code_resent : copy.code_sent) +
                    state.claims.email
                  }
                  color="success"
                />
              )}
              <input type="hidden" name="action" value="verify" />
              <input
                data-component="input"
                autofocus
                minLength={6}
                maxLength={6}
                type="text"
                name="code"
                required
                inputmode="numeric"
                autocomplete="one-time-code"
                placeholder={copy.code_placeholder}
              />
              <button data-component="button">{copy.button_continue}</button>
            </form>
            <form method="post">
              {Object.entries(state.claims).map(([key, value]) => (
                <input
                  key={key}
                  type="hidden"
                  name={key}
                  value={value}
                  className="hidden"
                />
              ))}
              <input type="hidden" name="action" value="request" />
              <div data-component="form-footer">
                <span>
                  {copy.code_didnt_get}{" "}
                  <button data-component="link">{copy.code_resend}</button>
                </span>
              </div>
            </form>
          </Layout>
        )
        return new Response(jsx.toString(), {
          headers: {
            "Content-Type": "text/html",
          },
        })
      }

      throw new UnknownStateError()
    },
  } satisfies CodeAdapterOptions
}
