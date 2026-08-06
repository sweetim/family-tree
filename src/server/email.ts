import nodemailer, { type Transporter } from "nodemailer"
import { match } from "ts-pattern"
import { renderAccessRequestOwnerHtml, renderTreeStatusHtml } from "./emails"

type SmtpConfig = {
  host: string
  port: number
  user: string
  password: string
}

/**
 * Resolve the SMTP transport config from the environment. Returns null when any
 * required value is missing so callers can short-circuit without throwing.
 */
function readSmtpConfig(): SmtpConfig | null {
  const host = process.env.SMTP_HOST
  const user = process.env.SMTP_USER
  const password = process.env.SMTP_PASSWORD
  if (!host || !user || !password) return null
  const port = Number(process.env.SMTP_PORT ?? 465)
  return { host, port, user, password }
}

let cached: Transporter | null = null

function getTransporter(config: SmtpConfig): Transporter {
  if (!cached) {
    cached = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.port === 465,
      auth: { user: config.user, pass: config.password },
    })
  }
  return cached
}

function appBaseUrl(): string {
  return process.env.BETTER_AUTH_URL ?? "http://localhost:3000"
}

type OutgoingMail = {
  to: string
  subject: string
  text: string
  html: string
}

/**
 * Send a single message, swallowing every failure. Email is best-effort: a
 * delivery problem must never break the request/approval flow that triggered it.
 */
async function sendMail(mail: OutgoingMail): Promise<void> {
  const config = readSmtpConfig()
  if (!config) {
    console.warn("SMTP not configured; skipping email", { to: mail.to })
    return
  }
  try {
    await getTransporter(config).sendMail({
      from: config.user,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    })
  } catch (error) {
    console.error("failed to send email", error)
  }
}

export type AccessRequestOwnerNotification = {
  ownerEmail: string
  ownerName: string
  treeName: string
  requesterName: string
  requesterEmail: string
  comment: string
}

/** Notify the tree owner that a new access request is awaiting review. */
export async function notifyOwnerOfAccessRequest(
  data: AccessRequestOwnerNotification,
): Promise<void> {
  const reviewUrl = `${appBaseUrl()}/sharing`
  const subject = `New access request for "${data.treeName}"`
  const text = [
    `${data.requesterName} (${data.requesterEmail}) requested access to your tree "${data.treeName}".`,
    "",
    `Note: ${data.comment}`,
    "",
    `Review it at ${reviewUrl}`,
  ].join("\n")
  const html = await renderAccessRequestOwnerHtml({
    requesterName: data.requesterName,
    requesterEmail: data.requesterEmail,
    treeName: data.treeName,
    comment: data.comment,
    reviewUrl,
  })
  await sendMail({ to: data.ownerEmail, subject, text, html })
}

export type AccessRequestResolutionNotification = {
  requesterEmail: string
  requesterName: string
  treeName: string
  treeId: string
  approved: boolean
}

/**
 * Notify the requester that their access request was resolved. Renders the
 * shared React Email card template (cream backdrop, FamiKi wordmark, coloured
 * status banner, and a cobalt action button).
 */
export async function notifyRequesterOfResolution(
  data: AccessRequestResolutionNotification,
): Promise<void> {
  const treeUrl = `${appBaseUrl()}/tree/${data.treeId}`
  const approved = data.approved
  const subject = approved
    ? `Access approved for "${data.treeName}"`
    : `Access request declined for "${data.treeName}"`
  const bannerText = approved
    ? "Your access request was approved."
    : "Your access request was declined."
  const bodyLine1 = approved
    ? "The owner approved your request."
    : "The owner declined your request to view this family tree."
  const bodyLine2 = approved
    ? "You can now open this tree and explore everyone in it."
    : "If anything has changed, you can send a new request."
  const button = approved ? "Open your tree" : "Request again"
  const text = [
    `Hi ${data.requesterName},`,
    "",
    `${bodyLine1} ${bodyLine2}`,
    "",
    approved ? `Open it: ${treeUrl}` : `Send a new request: ${treeUrl}`,
  ].join("\n")
  const html = await renderTreeStatusHtml({
    treeName: data.treeName,
    treeUrl,
    bannerTone: approved ? "success" : "danger",
    bannerText,
    bodyLine1,
    bodyLine2,
    buttonLabel: button,
  })
  await sendMail({ to: data.requesterEmail, subject, text, html })
}

export type ShareChange =
  | { kind: "granted"; role: "viewer" | "editor" }
  | { kind: "roleChanged"; role: "viewer" | "editor" }
  | { kind: "revoked" }

export type ShareChangeNotification = {
  granteeEmail: string
  granteeName: string | null
  ownerName: string | null
  treeName: string
  treeId: string
  change: ShareChange
}

type ShareMessage = {
  subject: string
  bannerTone: "success" | "danger"
  bannerText: string
  bodyLine1: string
  bodyLine2: string
  button: string
}

/**
 * Notify a grantee that their access to a tree was granted, changed, or
 * revoked by its owner. Reuses the same React Email card template as the
 * access-request resolution email. Best-effort: failures are swallowed by
 * `sendMail`.
 */
export async function notifyShareChange(
  data: ShareChangeNotification,
): Promise<void> {
  const treeUrl = `${appBaseUrl()}/tree/${data.treeId}`
  const actor = data.ownerName ?? "The tree owner"
  const greeting = data.granteeName ? `Hi ${data.granteeName},` : "Hi,"
  const message: ShareMessage = match(data.change)
    .with({ kind: "granted" }, ({ role }) => ({
      subject: `You've been invited to "${data.treeName}"`,
      bannerTone: "success" as const,
      bannerText: `You're now a ${roleLabel(role)}.`,
      bodyLine1: `${actor} invited you to "${data.treeName}" as a ${roleLabel(role)}.`,
      bodyLine2:
        role === "editor"
          ? "You can view and edit everyone in this family tree."
          : "You can view everyone in this family tree.",
      button: "Open your tree",
    }))
    .with({ kind: "roleChanged" }, ({ role }) => ({
      subject: `Your access to "${data.treeName}" changed`,
      bannerTone: "success" as const,
      bannerText: `You're now a ${roleLabel(role)}.`,
      bodyLine1: `${actor} changed your role on "${data.treeName}" to ${roleLabel(role)}.`,
      bodyLine2:
        role === "editor"
          ? "You can now view and edit this family tree."
          : "You can now view this family tree.",
      button: "Open your tree",
    }))
    .with({ kind: "revoked" }, () => ({
      subject: `Access to "${data.treeName}" revoked`,
      bannerTone: "danger" as const,
      bannerText: "Your access was removed.",
      bodyLine1: `${actor} removed your access to "${data.treeName}".`,
      bodyLine2:
        "If you think this was a mistake, you can request access again.",
      button: "Request access",
    }))
    .exhaustive()
  const text = [
    greeting,
    "",
    `${message.bodyLine1} ${message.bodyLine2}`,
    "",
    `${message.button}: ${treeUrl}`,
  ].join("\n")
  const html = await renderTreeStatusHtml({
    treeName: data.treeName,
    treeUrl,
    bannerTone: message.bannerTone,
    bannerText: message.bannerText,
    bodyLine1: message.bodyLine1,
    bodyLine2: message.bodyLine2,
    buttonLabel: message.button,
  })
  await sendMail({
    to: data.granteeEmail,
    subject: message.subject,
    text,
    html,
  })
}

function roleLabel(role: "viewer" | "editor"): string {
  return role === "editor" ? "Editor" : "Viewer"
}
