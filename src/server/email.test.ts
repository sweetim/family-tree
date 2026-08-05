import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"

type MailArgs = {
  from: string
  to: string
  subject: string
  text: string
  html: string
}

const sendMail = mock<(_mail: MailArgs) => Promise<void>>(() =>
  Promise.resolve(),
)
const createTransport = mock(() => ({ sendMail }))

mock.module("nodemailer", () => ({
  default: { createTransport },
  createTransport,
}))

const { notifyOwnerOfAccessRequest, notifyRequesterOfResolution, notifyShareChange } =
  await import("./email")

function lastMail(): MailArgs {
  const mail = sendMail.mock.calls.at(0)?.at(0)
  if (!mail) throw new Error("sendMail was not called")
  return mail
}

const ENV = { ...process.env }

beforeEach(() => {
  sendMail.mockClear()
  createTransport.mockClear()
  process.env.SMTP_HOST = "smtp.zoho.com"
  process.env.SMTP_PORT = "465"
  process.env.SMTP_USER = "noreply@example.com"
  process.env.SMTP_PASSWORD = "secret"
  process.env.BETTER_AUTH_URL = "https://tree.example.com"
})

afterEach(() => {
  process.env = { ...ENV }
})

describe("notifyOwnerOfAccessRequest", () => {
  test("sends to the owner with requester, comment, and a review link", async () => {
    await notifyOwnerOfAccessRequest({
      ownerEmail: "owner@example.com",
      ownerName: "Owner",
      treeName: "Smith Family",
      requesterName: "Alice",
      requesterEmail: "alice@example.com",
      comment: "I am a cousin",
    })

    expect(sendMail).toHaveBeenCalledTimes(1)
    const mail = lastMail()
    expect(mail.to).toBe("owner@example.com")
    expect(mail.from).toBe("noreply@example.com")
    expect(mail.subject).toContain("Smith Family")
    expect(mail.text).toContain("Alice (alice@example.com)")
    expect(mail.text).toContain("I am a cousin")
    expect(mail.text).toContain("https://tree.example.com/sharing")
  })

  test("is best-effort: skips silently when SMTP is unconfigured", async () => {
    delete process.env.SMTP_HOST
    delete process.env.SMTP_USER
    delete process.env.SMTP_PASSWORD

    await expect(
      notifyOwnerOfAccessRequest({
        ownerEmail: "owner@example.com",
        ownerName: "Owner",
        treeName: "Smith Family",
        requesterName: "Alice",
        requesterEmail: "alice@example.com",
        comment: "hi",
      }),
    ).resolves.toBeUndefined()
    expect(sendMail).not.toHaveBeenCalled()
  })
})

describe("notifyRequesterOfResolution", () => {
  test("approval message addresses the requester", async () => {
    await notifyRequesterOfResolution({
      requesterEmail: "alice@example.com",
      requesterName: "Alice",
      treeName: "Smith Family",
      treeId: "tree_123",
      approved: true,
    })

    expect(sendMail).toHaveBeenCalledTimes(1)
    const mail = lastMail()
    expect(mail.to).toBe("alice@example.com")
    expect(mail.subject).toBe('Access approved for "Smith Family"')
    expect(mail.text).toContain("approved")
    expect(mail.text).toContain("https://tree.example.com/tree/tree_123")
    expect(mail.html).toContain("Your access request was approved.")
    expect(mail.html).toContain("&quot;Smith Family&quot;")
    expect(mail.html).toContain("Open your tree")
    expect(mail.html).toContain("https://tree.example.com/tree/tree_123")
    expect(mail.html).toContain("FamiKi")
    expect(mail.html).not.toContain("<img")
    expect(mail.html).toContain("The owner approved your request.<br>")
    expect(mail.html).not.toContain("A private home for family history")
  })

  test("denial message says the request was declined", async () => {
    await notifyRequesterOfResolution({
      requesterEmail: "alice@example.com",
      requesterName: "Alice",
      treeName: "Smith Family",
      treeId: "tree_123",
      approved: false,
    })

    expect(sendMail).toHaveBeenCalledTimes(1)
    const mail = lastMail()
    expect(mail.subject).toBe('Access request declined for "Smith Family"')
    expect(mail.text).toContain("declined")
    expect(mail.html).toContain("Your access request was declined.")
    expect(mail.html).toContain("Request again")
    expect(mail.html).toContain(
      "The owner declined your request to view this family tree.<br>",
    )
  })
})

describe("notifyShareChange", () => {
  test("grant message invites the grantee with a tree link", async () => {
    await notifyShareChange({
      granteeEmail: "alice@example.com",
      granteeName: "Alice",
      ownerName: "Owner",
      treeName: "Smith Family",
      treeId: "tree_123",
      change: { kind: "granted", role: "editor" },
    })

    expect(sendMail).toHaveBeenCalledTimes(1)
    const mail = lastMail()
    expect(mail.to).toBe("alice@example.com")
    expect(mail.subject).toBe('You\'ve been invited to "Smith Family"')
    expect(mail.text).toContain("Hi Alice,")
    expect(mail.text).toContain("invited you to \"Smith Family\" as a Editor")
    expect(mail.text).toContain("https://tree.example.com/tree/tree_123")
    expect(mail.html).toContain("You're now a Editor.")
    expect(mail.html).toContain("Open your tree")
    expect(mail.html).toContain("FamiKi")
  })

  test("role change message reports the new role", async () => {
    await notifyShareChange({
      granteeEmail: "alice@example.com",
      granteeName: "Alice",
      ownerName: "Owner",
      treeName: "Smith Family",
      treeId: "tree_123",
      change: { kind: "roleChanged", role: "viewer" },
    })

    const mail = lastMail()
    expect(mail.subject).toBe('Your access to "Smith Family" changed')
    expect(mail.html).toContain("You're now a Viewer.")
    expect(mail.html).toContain("changed your role on")
    expect(mail.html).toContain("Open your tree")
  })

  test("revocation message uses the danger banner and request link", async () => {
    await notifyShareChange({
      granteeEmail: "alice@example.com",
      granteeName: null,
      ownerName: null,
      treeName: "Smith Family",
      treeId: "tree_123",
      change: { kind: "revoked" },
    })

    const mail = lastMail()
    expect(mail.subject).toBe('Access to "Smith Family" revoked')
    expect(mail.text).toContain("Hi,")
    expect(mail.text).toContain("The tree owner removed your access")
    expect(mail.html).toContain("Your access was removed.")
    expect(mail.html).toContain("Request access")
    expect(mail.html).toContain("https://tree.example.com/tree/tree_123")
  })

  test("is best-effort: skips silently when SMTP is unconfigured", async () => {
    delete process.env.SMTP_HOST
    delete process.env.SMTP_USER
    delete process.env.SMTP_PASSWORD

    await expect(
      notifyShareChange({
        granteeEmail: "alice@example.com",
        granteeName: "Alice",
        ownerName: "Owner",
        treeName: "Smith Family",
        treeId: "tree_123",
        change: { kind: "granted", role: "viewer" },
      }),
    ).resolves.toBeUndefined()
    expect(sendMail).not.toHaveBeenCalled()
  })
})
