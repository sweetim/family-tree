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

const { notifyOwnerOfAccessRequest, notifyRequesterOfResolution } =
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
  })
})
