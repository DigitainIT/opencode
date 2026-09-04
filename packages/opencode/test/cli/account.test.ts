import { describe, expect, test } from "bun:test"
import stripAnsi from "strip-ansi"

import { consoleUrl, defaultConsoleUrl, formatAccountLabel, formatOrgLine } from "../../src/cli/cmd/account"

describe("console account display", () => {
  test("uses oc.digitain.ai as the default login URL", () => {
    expect(defaultConsoleUrl).toBe("https://oc.digitain.ai")
  })

  test("consoleUrl honors the OPENCODE_CONSOLE_URL override", () => {
    const original = process.env["OPENCODE_CONSOLE_URL"]
    try {
      delete process.env["OPENCODE_CONSOLE_URL"]
      expect(consoleUrl()).toBe("https://oc.digitain.ai")
      process.env["OPENCODE_CONSOLE_URL"] = "https://oc-dev.digitain.ai"
      expect(consoleUrl()).toBe("https://oc-dev.digitain.ai")
    } finally {
      if (original === undefined) delete process.env["OPENCODE_CONSOLE_URL"]
      else process.env["OPENCODE_CONSOLE_URL"] = original
    }
  })

  test("includes the account url in account labels", () => {
    expect(stripAnsi(formatAccountLabel({ email: "one@example.com", url: "https://one.example.com" }, false))).toBe(
      "one@example.com https://one.example.com",
    )
  })

  test("includes the active marker in account labels", () => {
    expect(stripAnsi(formatAccountLabel({ email: "one@example.com", url: "https://one.example.com" }, true))).toBe(
      "one@example.com https://one.example.com (active)",
    )
  })

  test("includes the account url in org rows", () => {
    expect(
      stripAnsi(
        formatOrgLine({ email: "one@example.com", url: "https://one.example.com" }, { id: "org-1", name: "One" }, true),
      ),
    ).toBe("  ● One  one@example.com  https://one.example.com  org-1")
  })
})
