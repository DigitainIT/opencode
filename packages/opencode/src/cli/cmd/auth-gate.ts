import path from "path"
import { Clock, Duration, Effect, Option, Schema } from "effect"
import { HttpClientError } from "effect/unstable/http"
import { Flag } from "@opencode-ai/core/flag/flag"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"
import { Account } from "@/account/account"
import { AccountServiceError, type AccountError, type AccountID } from "@/account/schema"
import { normalizeServerUrl } from "@/account/url"
import { consoleUrl, loginEffect } from "./account"
import { fail } from "../effect-cmd"

const message = (server: string) => `Login to ${server} is required to continue. Run: opencode console login`

export const GRACE = Duration.toMillis(Duration.hours(24))

export const withinGrace = (validatedAt: number, now: number) => now - validatedAt < GRACE

// The console token check distinguishes revoked credentials (HTTP 401/403) from
// transient failures (network errors, 5xx) so offline use can fall back to the
// grace window instead of forcing a login that cannot succeed anyway.
export const classifyAccountError = (error: AccountError): "revoked" | "transient" => {
  if (error instanceof AccountServiceError && HttpClientError.isHttpClientError(error.cause)) {
    const status = error.cause.response?.status
    if (status === 401 || status === 403) return "revoked"
  }
  return "transient"
}

const Validations = Schema.Record(Schema.String, Schema.Number)

const cacheFile = () => path.join(Global.Path.state, "console-auth.json")

const cacheKey = (server: string, accountID: AccountID) => `${server}|${accountID}`

const readValidations = Effect.fnUntraced(function* () {
  const fs = yield* FSUtil.Service
  return yield* fs.readJson(cacheFile()).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Validations)),
    Effect.catch(() => Effect.succeed({} as Record<string, number>)),
  )
})

const recordValidation = Effect.fnUntraced(function* (server: string, accountID: AccountID) {
  const fs = yield* FSUtil.Service
  const now = yield* Clock.currentTimeMillis
  const all = yield* readValidations()
  yield* fs
    .writeJson(cacheFile(), { ...all, [cacheKey(server, accountID)]: now })
    .pipe(Effect.catch(() => Effect.void))
})

const lastValidation = Effect.fnUntraced(function* (server: string, accountID: AccountID) {
  const all = yield* readValidations()
  return Option.fromNullishOr(all[cacheKey(server, accountID)])
})

export const requireConsoleLogin = Effect.fn("Cli.requireConsoleLogin")(function* () {
  const service = yield* Account.Service
  const server = normalizeServerUrl(consoleUrl())

  const envToken = Flag.OPENCODE_CONSOLE_TOKEN
  if (envToken) {
    const check = yield* service.validate(server, envToken)
    if (check === "valid") return
    if (check === "revoked") yield* fail(`OPENCODE_CONSOLE_TOKEN was rejected by ${server}. Provide a valid token.`)
    yield* fail(`Could not reach ${server} to validate OPENCODE_CONSOLE_TOKEN. Check your network and try again.`)
  }

  const active = yield* service.active().pipe(Effect.orDie)
  if (Option.isSome(active) && normalizeServerUrl(active.value.url) === server) {
    const check = yield* service.orgs(active.value.id).pipe(
      Effect.as("valid" as const),
      Effect.catch((error) => Effect.succeed(classifyAccountError(error))),
    )
    if (check === "valid") {
      yield* recordValidation(server, active.value.id)
      return
    }
    if (check === "transient") {
      const last = yield* lastValidation(server, active.value.id)
      const now = yield* Clock.currentTimeMillis
      if (Option.isSome(last) && withinGrace(last.value, now)) return
      yield* fail(
        `Could not reach ${server} to verify your console login, and the offline grace period (24h) has expired. Check your network and try again.`,
      )
    }
  }

  if (!process.stdin.isTTY) {
    yield* fail(`${message(server)} In non-interactive environments set OPENCODE_CONSOLE_TOKEN instead.`)
  }

  yield* loginEffect(server).pipe(Effect.catch(() => fail(message(server))))

  const after = yield* service.active().pipe(Effect.orDie)
  if (Option.isNone(after) || normalizeServerUrl(after.value.url) !== server) {
    yield* fail(message(server))
    return
  }
  const verified = yield* service.orgs(after.value.id).pipe(
    Effect.as(true),
    Effect.catch(() => Effect.succeed(false)),
  )
  if (!verified) yield* fail(message(server))
  yield* recordValidation(server, after.value.id)
})
