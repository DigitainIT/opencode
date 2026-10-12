import { describe, expect, test } from "bun:test"
import { HttpClientError, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"

import { AccountRepoError, AccountServiceError, AccountTransportError } from "../../src/account/schema"
import { classifyAccountError, GRACE, withinGrace } from "../../src/cli/cmd/auth-gate"

const statusError = (status: number) => {
  const request = HttpClientRequest.get("https://oc.digitain.ai/api/orgs")
  return new AccountServiceError({
    message: "x",
    cause: new HttpClientError.HttpClientError({
      reason: new HttpClientError.StatusCodeError({
        request,
        response: HttpClientResponse.fromWeb(request, new Response(null, { status })),
      }),
    }),
  })
}

describe("auth gate error classification", () => {
  test("401 and 403 responses mean the credential is revoked", () => {
    expect(classifyAccountError(statusError(401))).toBe("revoked")
    expect(classifyAccountError(statusError(403))).toBe("revoked")
  })

  test("other HTTP statuses are transient", () => {
    expect(classifyAccountError(statusError(500))).toBe("transient")
    expect(classifyAccountError(statusError(429))).toBe("transient")
  })

  test("transport failures without a response are transient", () => {
    const request = HttpClientRequest.get("https://oc.digitain.ai/api/orgs")
    const error = AccountTransportError.fromHttpClientError(new HttpClientError.TransportError({ request }))
    expect(classifyAccountError(error)).toBe("transient")
  })

  test("repo errors are transient", () => {
    expect(classifyAccountError(new AccountRepoError({ message: "x" }))).toBe("transient")
  })

  test("service errors without an HTTP cause are transient", () => {
    expect(classifyAccountError(new AccountServiceError({ message: "x" }))).toBe("transient")
  })
})

describe("auth gate offline grace", () => {
  test("within the grace window", () => {
    expect(withinGrace(1000, 1000)).toBe(true)
    expect(withinGrace(1000, 1000 + GRACE - 1)).toBe(true)
  })

  test("past the grace window", () => {
    expect(withinGrace(1000, 1000 + GRACE)).toBe(false)
  })
})
