import { Effect, Option } from "effect"
import { Account } from "@/account/account"
import { normalizeServerUrl } from "@/account/url"
import { consoleUrl, loginEffect } from "./account"
import { fail } from "../effect-cmd"

const message = (server: string) => `Login to ${server} is required to continue. Run: opencode console login`

export const requireConsoleLogin = Effect.fn("Cli.requireConsoleLogin")(function* () {
  const service = yield* Account.Service
  const server = normalizeServerUrl(consoleUrl())

  const active = yield* service.active().pipe(Effect.orDie)
  if (Option.isSome(active) && normalizeServerUrl(active.value.url) === server) {
    const valid = yield* service.orgs(active.value.id).pipe(
      Effect.as(true),
      Effect.catch(() => Effect.succeed(false)),
    )
    if (valid) return
  }

  yield* loginEffect(server).pipe(
    Effect.catch(() => fail(message(server))),
  )

  const after = yield* service.active().pipe(Effect.orDie)
  if (Option.isNone(after) || normalizeServerUrl(after.value.url) !== server) {
    yield* fail(message(server))
  }
})
