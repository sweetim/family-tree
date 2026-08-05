import nodemailer, { type Transporter } from "nodemailer"

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
  const html = [
    `<p><strong>${escapeHtml(data.requesterName)}</strong> `,
    `(${escapeHtml(data.requesterEmail)}) requested access to your tree `,
    `"${escapeHtml(data.treeName)}".</p>`,
    `<p><em>Note:</em> ${escapeHtml(data.comment)}</p>`,
    `<p><a href="${reviewUrl}">Review the request</a></p>`,
  ].join("")
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
 * Notify the requester that their access request was resolved. The HTML mirrors
 * the request-access card the requester sees in-app: a cream backdrop, a white
 * rounded card with the FamiKi logo, a coloured status banner, the tree name,
 * and a cobalt action button. Table-based with inline styles for email-client
 * robustness.
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
  const body = approved
    ? "The owner approved your request. You can now open this tree and explore everyone in it."
    : "The owner declined your request to view this family tree. If anything has changed, you can send a new request."
  const button = approved ? "Open your tree" : "Request again"
  const text = approved
    ? [
        `Hi ${data.requesterName},`,
        "",
        `Your request to view "${data.treeName}" was approved. You can now open the tree and explore everyone in it.`,
        "",
        `Open it: ${treeUrl}`,
      ].join("\n")
    : [
        `Hi ${data.requesterName},`,
        "",
        `Your request to view "${data.treeName}" was declined by the owner. If you'd like to try again, send a new request:`,
        "",
        treeUrl,
      ].join("\n")
  const html = renderCard([
    renderBanner(approved ? "success" : "danger", bannerText),
    `<h1 style="margin:24px 0 4px;font-size:24px;line-height:1.1;font-weight:700;letter-spacing:-0.045em;color:#27241f;text-align:center;">${escapeHtml(`"${data.treeName}"`)}</h1>`,
    `<p style="margin:0 0 20px;font-size:13px;font-weight:600;color:#9b9384;text-align:center;">Family tree</p>`,
    `<p style="margin:0 0 24px;font-size:15px;line-height:24px;color:#686155;text-align:center;">${escapeHtml(body)}</p>`,
    renderButton(button, treeUrl),
  ])
  await sendMail({ to: data.requesterEmail, subject, text, html })
}

const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

type BannerTone = "success" | "danger"

const BANNER: Record<
  BannerTone,
  { bg: string; border: string; color: string; badge: string }
> = {
  success: {
    bg: "#ecfdf5",
    border: "#a7f3d0",
    color: "#047857",
    badge: "\u2713",
  },
  danger: { bg: "#fef2f2", border: "#fecaca", color: "#b91c1c", badge: "!" },
}

/** Coloured status banner matching the request page's approve/deny notices. */
function renderBanner(tone: BannerTone, text: string): string {
  const style = BANNER[tone]
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"`
    + ` style="background:${style.bg};border:1px solid ${style.border};border-radius:14px;">`
    + '<tr><td style="padding:12px 14px;font-family:'
    + FONT_STACK
    + `;font-size:14px;line-height:20px;color:${style.color};">`
    + `<span style="display:inline-block;min-width:20px;height:20px;line-height:20px;text-align:center;border-radius:999px;background:${style.color};color:#ffffff;font-size:12px;font-weight:700;margin-right:8px;vertical-align:middle;">${style.badge}</span>`
    + `<span style="vertical-align:middle;">${escapeHtml(text)}</span>`
    + "</td></tr></table>"
  )
}

/** Cobalt pill button, mirroring the in-app primary action. */
function renderButton(label: string, href: string): string {
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">`
    + '<tr><td align="center" style="border-radius:12px;background:#1f41e0;">'
    + `<a href="${href}" target="_blank" style="display:inline-block;padding:12px 24px;font-family:`
    + FONT_STACK
    + `;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">${escapeHtml(label)}</a>`
    + "</td></tr></table>"
  )
}

/**
 * Wrap message content in the FamiKi card chrome: cream backdrop, white rounded
 * card, logo + wordmark header, and a tagline footer.
 */
function renderCard(inner: string[]): string {
  const base = appBaseUrl()
  return (
    '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + `<title>FamiKi</title></head>`
    + `<body style="margin:0;padding:0;background:#f7f4ed;font-family:${FONT_STACK};">`
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f4ed;">'
    + '<tr><td align="center" style="padding:32px 16px;">'
    + '<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:#ffffff;border:1px solid #f0ece2;border-radius:28px;box-shadow:0 28px 70px rgba(47,39,27,0.11);">'
    + '<tr><td align="center" style="padding:36px 32px;">'
    + '<table role="presentation" cellpadding="0" cellspacing="0" align="center"><tr>'
    + `<td style="padding-right:10px;vertical-align:middle;"><img src="${base}/logo.webp" width="36" height="36" alt="FamiKi" style="display:block;border:0;"></td>`
    + `<td style="font-family:${FONT_STACK};font-size:18px;font-weight:700;letter-spacing:-0.04em;color:#27241f;vertical-align:middle;">FamiKi</td>`
    + "</tr></table>"
    + inner.join("")
    + '<p style="margin:28px 0 0;font-size:12px;line-height:18px;color:#9b9384;">A private home for family history</p>'
    + "</td></tr></table></td></tr></table></body></html>"
  )
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}
